"use strict";
/**
 * mistral.client.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight Mistral AI HTTP client.
 *
 * Key features the user asked for:
 *  1. PROMPT-LEVEL CACHE  — identical (system+user) prompts are hashed and their
 *     JSON responses stored in Redis so we never pay tokens for a repeated query.
 *  2. TOKEN BUDGET GUARD  — a rolling-window TPM counter (Redis key with 60s TTL)
 *     enforces the 50 k TPM ceiling.  If a call would exceed the budget, the client
 *     throws a distinct BudgetError so the calling service can fall back gracefully.
 *  3. COMPACT PROMPTS     — we always send `response_format: { type: "json_object" }`
 *     so Mistral skips prose and returns only the JSON payload, minimising token use.
 *  4. No extra npm package — uses Node 18+ native `fetch` (already available in the
 *     Express 5 environment).
 */

const crypto   = require("crypto");
const env      = require("../../config/env");
const cache    = require("../../common/services/cache.service");

const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
// Redis key that accumulates tokens used in the current 60-second window
const TPM_COUNTER_KEY  = "mistral:tpm:counter";
// Prefix for prompt-level response cache
const PROMPT_CACHE_PFX = "mistral:cache:";
// How long we cache a specific prompt→response pair (1 hour)
const PROMPT_CACHE_TTL = 3600;

class BudgetError extends Error {
    constructor(used, limit) {
        super(`Mistral TPM budget exceeded: ${used}/${limit} tokens used this minute`);
        this.name = "BudgetError";
        this.isBudget = true;
    }
}

class MistralClient {
    constructor() {
        this.apiKey    = (env.mistral.apiKey || "").trim();
        this.model     = env.mistral.model;
        this.maxTokens = env.mistral.maxTokens;   // per-call token cap (kept low)
        this.tpmLimit  = env.mistral.tpmLimit;    // 50 000 TPM by default
    }

    /** True only when an API key is configured */
    get isEnabled() {
        return Boolean(this.apiKey);
    }

    // ─── Token-budget helpers ──────────────────────────────────────────────────

    /**
     * Rough approximation: 1 token ≈ 4 characters (works well for English text).
     * We use this for the *pre-flight* check before we know actual usage.
     */
    _estimateTokens(text) {
        return Math.ceil((text || "").length / 4);
    }

    /**
     * Atomically increment the rolling-window TPM counter and return the new total.
     * The Redis key expires after 60 seconds so the window resets automatically.
     */
    async _incrementTpm(tokens) {
        try {
            const newVal = await cache.redis.incrby(TPM_COUNTER_KEY, tokens);
            // Re-arm the 60-second TTL on every write so it's a true sliding window
            await cache.redis.expire(TPM_COUNTER_KEY, 60);
            return newVal;
        } catch {
            return 0; // Redis unavailable — allow the call
        }
    }

    async _currentTpm() {
        try {
            const v = await cache.redis.get(TPM_COUNTER_KEY);
            return v ? parseInt(v, 10) : 0;
        } catch {
            return 0;
        }
    }

    // ─── Prompt cache ─────────────────────────────────────────────────────────

    /** Deterministic SHA-256 fingerprint of a (system, user) prompt pair */
    _promptHash(systemPrompt, userMessage) {
        return crypto
            .createHash("sha256")
            .update(systemPrompt + "\x00" + userMessage)
            .digest("hex")
            .slice(0, 32); // 32 hex chars is enough for uniqueness
    }

    async _getCachedResponse(hash) {
        return cache.get(PROMPT_CACHE_PFX + hash);
    }

    async _setCachedResponse(hash, parsed) {
        await cache.set(PROMPT_CACHE_PFX + hash, parsed, PROMPT_CACHE_TTL);
    }

    // ─── Core call ────────────────────────────────────────────────────────────

    /**
     * Call Mistral and return a parsed JSON object.
     *
     * @param {string} systemPrompt  — role: "system" message (task definition)
     * @param {string} userMessage   — role: "user" message (the actual query)
     * @param {object} [opts]
     * @param {boolean} [opts.skipCache=false]  — bypass prompt cache for one-off calls
     * @returns {Promise<object>}    — parsed JSON from Mistral's response
     */
    async callJSON(systemPrompt, userMessage, { skipCache = false } = {}) {
        if (!this.isEnabled) {
            throw new Error("Mistral API key not configured");
        }

        const hash = this._promptHash(systemPrompt, userMessage);

        // 1. Prompt cache hit — free, no tokens consumed
        if (!skipCache) {
            const cached = await this._getCachedResponse(hash);
            if (cached) {
                return cached;
            }
        }

        // 2. Pre-flight TPM guard (rough estimate for the combined prompt)
        const estimatedIn = this._estimateTokens(systemPrompt + userMessage);
        const currentTpm  = await this._currentTpm();
        // Reserve headroom: assume output is at most maxTokens
        if (currentTpm + estimatedIn + this.maxTokens > this.tpmLimit) {
            throw new BudgetError(currentTpm, this.tpmLimit);
        }

        // 3. Mistral API call
        const body = {
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user",   content: userMessage  }
            ],
            max_tokens:      this.maxTokens,
            temperature:     0.2,          // near-deterministic for JSON extraction
            response_format: { type: "json_object" }
        };

        let response;
        let attempts = 0;
        while (attempts < 2) {
            attempts++;
            try {
                response = await fetch(MISTRAL_ENDPOINT, {
                    method:  "POST",
                    headers: {
                        "Content-Type":  "application/json",
                        "Authorization": `Bearer ${this.apiKey}`
                    },
                    body:   JSON.stringify(body),
                    signal: AbortSignal.timeout(12_000)  // 12 s timeout
                });
                if (response.status === 429 && attempts < 2) {
                    await new Promise(r => setTimeout(r, 800));
                    continue;
                }
                break;
            } catch (err) {
                if (attempts < 2) {
                    await new Promise(r => setTimeout(r, 800));
                    continue;
                }
                throw new Error(`Mistral network error: ${err.message}`);
            }
        }

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Mistral API ${response.status}: ${text.slice(0, 200)}`);
        }

        const data = await response.json();

        // 4. Post-call TPM accounting (use real usage when available)
        const actualTokens = data.usage
            ? (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0)
            : estimatedIn + this.maxTokens;
        await this._incrementTpm(actualTokens);

        // 5. Parse content
        let parsed;
        try {
            const content = data.choices?.[0]?.message?.content || "{}";
            parsed = JSON.parse(content);
        } catch {
            throw new Error("Mistral returned non-JSON content");
        }

        // 6. Cache the result for future identical prompts
        if (!skipCache) {
            await this._setCachedResponse(hash, parsed);
        }

        return parsed;
    }
}

module.exports = new MistralClient();
module.exports.BudgetError = BudgetError;
