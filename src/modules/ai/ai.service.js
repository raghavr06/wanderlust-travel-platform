"use strict";
/**
 * ai.service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Two responsibilities:
 *
 *  A. searchListingsWithAI(query)
 *     ─ Converts a natural-language query to a structured MongoDB filter via
 *       Mistral (JSON-mode, prompt-cached, TPM-guarded).
 *     ─ Falls back to multi-field regex search when Mistral is unavailable or
 *       the budget is exceeded.
 *
 *  B. getRecommendationsFromPastTrips(userId)
 *     ─ Modern, data-driven approach:
 *         1. Aggregate the user's booking history into a behavioural signal vector
 *            (category mix, amenity preferences, spend band, guest count, geography).
 *         2. Convert that vector into a compact "traveller profile" string — sent to
 *            Mistral as a single low-token prompt.
 *         3. Mistral returns a *ranked preference object* (no static rules).
 *         4. We then query MongoDB with those preferences and score each candidate
 *            listing locally (no second LLM call).
 *     ─ Falls back to top-rated featured listings when the user has no history or
 *       Mistral is unavailable.
 */

const listingRepository = require("../listings/listing.repository.js");
const bookingRepository = require("../bookings/booking.repository.js");
const listingService    = require("../listings/listing.service.js");
const mistral           = require("../../infrastructure/mistral/mistral.client.js");
const { BudgetError }   = require("../../infrastructure/mistral/mistral.client.js");
const cacheService      = require("../../common/services/cache.service.js");
const { LISTING_CATEGORIES, LISTING_AMENITIES } = require("../listings/listing.model.js");

// ─── Constants ────────────────────────────────────────────────────────────────

// Cache key prefixes  (separate from Mistral prompt cache — these hold DB results)
const AI_SEARCH_RESULT_PFX = "ai:search:result:";
const AI_RECO_RESULT_PFX   = "ai:reco:";
const AI_RESULT_TTL        = 1800; // 30 min — shorter than listing cache (30 min ok)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Cheap deterministic cache key for a search query string */
function searchCacheKey(query) {
    return AI_SEARCH_RESULT_PFX + Buffer.from(query.toLowerCase().trim())
        .toString("base64").replace(/[^a-z0-9]/gi, "").slice(0, 40);
}

/** Decorate a lean listing with rating/numReviews fields */
function decorateRating(listing) {
    const reviews = listing.reviews || [];
    const valid   = reviews.filter(r => r && typeof r.rating === "number");
    listing.numReviews = valid.length;
    listing.rating = valid.length
        ? Math.round((valid.reduce((s, r) => s + r.rating, 0) / valid.length) * 10) / 10
        : 0;
    delete listing.reviews;
    return listing;
}

// ─── System Prompts ───────────────────────────────────────────────────────────

/**
 * System prompt for natural-language search.
 * We keep it SHORT deliberately — cheaper tokens, faster response.
 * The list of valid categories/amenities acts as a vocabulary constraint so
 * Mistral never hallucinates unknown values.
 */
const SEARCH_SYSTEM_PROMPT = `You are a travel search parser.
Return ONLY valid JSON with these keys (omit key if not applicable):
{
  "categories": string[],   // from: ${JSON.stringify(LISTING_CATEGORIES)}
  "amenities":  string[],   // from: ${JSON.stringify(LISTING_AMENITIES)}
  "maxPrice":   number,     // per night in USD; null if not mentioned
  "minGuests":  number,     // null if not mentioned
  "keywords":   string[],   // 1-3 location/vibe keywords
  "rationale":  string      // ≤12 words explaining the match
}
Rules: output ONLY JSON, no prose, no markdown fences.`;

/**
 * System prompt for recommendation profile inference.
 * Input is a compact behavioural summary, not raw booking data.
 * Output is a ranked preferences object we use to score candidates.
 */
const RECO_SYSTEM_PROMPT = `You are a travel recommendation engine.
Given a traveller profile, return ONLY valid JSON:
{
  "preferredCategories": string[],  // ordered, best first; from: ${JSON.stringify(LISTING_CATEGORIES)}
  "mustHaveAmenities":   string[],  // from: ${JSON.stringify(LISTING_AMENITIES)}
  "niceToHaveAmenities": string[],
  "priceRange":  { "min": number, "max": number },
  "vibeKeywords": string[],          // ≤4 descriptive vibe words
  "reasoning": string                // ≤20 words
}
Rules: output ONLY JSON, no prose, no markdown fences.`;

// ─── A. Natural-language search ───────────────────────────────────────────────

/**
 * Build a MongoDB filter from Mistral-extracted criteria or smart NLP fallback.
 */
async function buildFilterFromQuery(query) {
    const trimmed = query.trim();

    if (!mistral.isEnabled) {
        return _smartFallbackFilter(trimmed);
    }

    let parsed;
    try {
        parsed = await mistral.callJSON(SEARCH_SYSTEM_PROMPT, trimmed);
    } catch (err) {
        if (err instanceof BudgetError) {
            console.warn("[AI] TPM budget reached — falling back to smart NLP search");
        } else {
            console.warn("[AI] Mistral search error:", err.message);
        }
        return _smartFallbackFilter(trimmed);
    }

    const filter = {};

    // Category filter
    const cats = (parsed.categories || []).filter(c => LISTING_CATEGORIES.includes(c));
    if (cats.length === 1) {
        filter.category = cats[0];
    } else if (cats.length > 1) {
        filter.category = { $in: cats };
    }

    // Price cap
    if (parsed.maxPrice && Number(parsed.maxPrice) > 0) {
        filter.price = { $lte: Number(parsed.maxPrice) };
    }

    // Minimum capacity
    if (parsed.minGuests && Number(parsed.minGuests) > 0) {
        filter.maxGuests = { $gte: Number(parsed.minGuests) };
    }

    // Amenity sub-filter
    const ams = (parsed.amenities || []).filter(a => LISTING_AMENITIES.includes(a));
    if (ams.length > 0) {
        filter.amenities = { $in: ams };
    }

    // Keyword regex across title / location / country / description
    const keywords = (parsed.keywords || []).filter(Boolean);
    if (keywords.length > 0) {
        const regex = new RegExp(keywords.join("|"), "i");
        const $or = [
            { title: regex }, { location: regex }, { country: regex },
            { description: regex }
        ];
        filter.$or = filter.$or ? [...filter.$or, ...$or] : $or;
    }

    return {
        filter,
        parsed,
        rationale: parsed.rationale || "Matched criteria extracted by AI",
        isMistral: true
    };
}

/**
 * Smart NLP Fallback Filter when Mistral API is rate limited or unavailable.
 * Extracts intent (categories, amenities, price bands, guests, keywords) locally.
 */
function _smartFallbackFilter(query) {
    const qLower = query.toLowerCase();
    const filterConditions = [];
    const matchedIntents = [];

    // 1. Category Detection
    const categoryMap = {
        "Mountains": ["mountain", "mountains", "hill", "hills", "alpine", "peak", "valley"],
        "Beach": ["beach", "beaches", "ocean", "sea", "coastal", "island", "sand", "waterfront"],
        "Lux": ["lux", "luxury", "villa", "resort", "honeymoon", "spa", "romantic"],
        "Iconic cities": ["city", "cities", "urban", "downtown", "metro"],
        "Rooms": ["room", "rooms", "suite", "studio", "bedroom"],
        "Castles": ["castle", "castles", "fort", "palace", "manor"],
        "Camping": ["camp", "camping", "tent", "cabin", "wood", "woods", "nature"],
        "Arctic": ["snow", "ice", "arctic", "glacier", "ski"],
        "Farms": ["farm", "farms", "ranch", "countryside", "barn"],
        "Trending": ["trending", "popular", "hospitality", "best", "top"]
    };

    const matchedCats = [];
    for (const [cat, keywords] of Object.entries(categoryMap)) {
        if (keywords.some(kw => qLower.includes(kw))) {
            matchedCats.push(cat);
        }
    }
    if (matchedCats.length > 0) {
        filterConditions.push({ category: matchedCats.length === 1 ? matchedCats[0] : { $in: matchedCats } });
        matchedIntents.push(`Category: ${matchedCats.join(", ")}`);
    }

    // 2. Price / Budget Detection
    const priceMatch = qLower.match(/under\s*\$?(\d+)|below\s*\$?(\d+)|\$?(\d+)\s*max/);
    if (priceMatch) {
        const val = Number(priceMatch[1] || priceMatch[2] || priceMatch[3]);
        if (val > 0) {
            filterConditions.push({ price: { $lte: val } });
            matchedIntents.push(`Price ≤ $${val}`);
        }
    } else if (qLower.includes("budget") || qLower.includes("cheap") || qLower.includes("affordable")) {
        filterConditions.push({ price: { $lte: 150 } });
        matchedIntents.push("Budget ≤ $150");
    }

    // 3. Guest / Family Detection
    if (qLower.includes("family") || qLower.includes("group") || qLower.includes("kids")) {
        filterConditions.push({ maxGuests: { $gte: 3 } });
        matchedIntents.push("Family (3+ guests)");
    }

    // 4. Token Keyword extraction
    const stopWords = new Set([
        "a", "an", "the", "in", "near", "for", "to", "with", "best", "stay", "place",
        "places", "of", "and", "or", "is", "at", "by", "under", "below", "top"
    ]);
    const tokens = qLower
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    if (tokens.length > 0) {
        const regex = new RegExp(tokens.join("|"), "i");
        filterConditions.push({
            $or: [
                { title: regex }, { location: regex },
                { country: regex }, { category: regex },
                { description: regex }
            ]
        });
        matchedIntents.push(`Keywords: ${tokens.slice(0, 3).join(", ")}`);
    }

    const filter = filterConditions.length > 0 ? { $or: filterConditions } : {};
    const rationale = matchedIntents.length > 0
        ? `Smart intent: ${matchedIntents.join(" · ")}`
        : `Smart match for "${query}"`;

    return { filter, rationale, isMistral: false };
}

// ─── B. Past-trip recommendation engine ───────────────────────────────────────

/**
 * Aggregate a user's confirmed bookings into a compact behavioural signal vector.
 * This is pure JS — no LLM involved yet — so it's fast and free.
 */
function _buildTravellerProfile(bookings) {
    const categoryFreq  = {};
    const amenityFreq   = {};
    const countries     = new Set();
    let   totalSpend    = 0;
    let   bookingCount  = 0;
    let   totalGuests   = 0;
    let   totalNights   = 0;

    for (const b of bookings) {
        const listing = b.listingId; // populated
        if (!listing) continue;

        bookingCount++;
        totalSpend  += b.totalPrice || 0;
        totalGuests += b.guests     || 1;

        const nights = listing
            ? Math.max(1, Math.ceil((new Date(b.checkOut) - new Date(b.checkIn)) / 86400000))
            : 1;
        totalNights += nights;

        if (listing.category) {
            categoryFreq[listing.category] = (categoryFreq[listing.category] || 0) + 1;
        }
        (listing.amenities || []).forEach(a => {
            amenityFreq[a] = (amenityFreq[a] || 0) + 1;
        });
        if (listing.country) countries.add(listing.country);
    }

    if (bookingCount === 0) return null;

    const avgNightlyRate = totalNights > 0
        ? Math.round(totalSpend / totalNights)
        : 0;
    const avgGuests = Math.round(totalGuests / bookingCount);

    // Top categories (sorted desc by frequency)
    const topCategories = Object.entries(categoryFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([c]) => c);

    // Top amenities (sorted desc)
    const topAmenities = Object.entries(amenityFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([a]) => a);

    return {
        bookingCount,
        topCategories,
        topAmenities,
        avgNightlyRate,
        avgGuests,
        countries: [...countries].slice(0, 6)
    };
}

/**
 * Compact profile → human-readable sentence to feed Mistral.
 * Deliberately terse to stay well under token budget.
 */
function _profileToPrompt(profile) {
    return [
        `Trips: ${profile.bookingCount}.`,
        profile.topCategories.length
            ? `Prefers: ${profile.topCategories.join(", ")}.`
            : "",
        profile.topAmenities.length
            ? `Likes amenities: ${profile.topAmenities.join(", ")}.`
            : "",
        `Avg nightly spend: $${profile.avgNightlyRate}.`,
        `Usual party size: ${profile.avgGuests}.`,
        profile.countries.length
            ? `Has visited: ${profile.countries.join(", ")}.`
            : ""
    ].filter(Boolean).join(" ");
}

/**
 * Score a candidate listing against Mistral's ranked preferences.
 * Returns a numeric score (higher = better match).
 */
function _scoreCandidate(listing, prefs, profile) {
    let score = 0;

    // Category match — position in preferredCategories gives a weight
    const catIdx = (prefs.preferredCategories || []).indexOf(listing.category);
    if (catIdx === 0) score += 40;
    else if (catIdx === 1) score += 25;
    else if (catIdx > 1)  score += 10;

    // Must-have amenities
    const amenities = listing.amenities || [];
    (prefs.mustHaveAmenities || []).forEach(a => {
        if (amenities.includes(a)) score += 15;
    });
    (prefs.niceToHaveAmenities || []).forEach(a => {
        if (amenities.includes(a)) score += 5;
    });

    // Price band — penalise if well outside expected range
    const pMin = prefs.priceRange?.min || 0;
    const pMax = prefs.priceRange?.max || Infinity;
    if (listing.price >= pMin && listing.price <= pMax) {
        score += 20;
    } else if (listing.price > pMax * 1.5) {
        score -= 15; // significantly over budget
    }

    // Guest capacity match
    if (profile && listing.maxGuests >= profile.avgGuests) score += 10;

    // Rating bonus (0–10 pts)
    score += Math.round((listing.rating || 0) * 2);

    return score;
}

// ─── Public Service Class ─────────────────────────────────────────────────────

class AiService {

    /**
     * Natural-language search: returns { listings, rationale, source }
     *  source: "mistral" | "fallback"
     */
    async searchListingsWithAI(query) {
        if (!query || !query.trim()) {
            const listings = await listingService.getListings({});
            return { listings, rationale: null, source: "default" };
        }

        // Result-level cache (keyed by query text, not by prompt hash)
        const resultKey = searchCacheKey(query);
        const cached    = await cacheService.get(resultKey);
        if (cached) return { ...cached, source: "cache" };

        const { filter, rationale, isMistral } = await buildFilterFromQuery(query);

        let listings = await listingRepository.find(filter, null, 30);
        listings.forEach(decorateRating);

        // Zero-results safeguard: if the filter returned 0 listings, try smart NLP fallback
        if (listings.length === 0) {
            const fallback = _smartFallbackFilter(query);
            listings = await listingRepository.find(fallback.filter, null, 30);
            listings.forEach(decorateRating);

            if (listings.length === 0) {
                // If still 0, return featured high-rated listings so the user is never left empty-handed
                listings = await listingService.getFeaturedListings(6);
            }
        }

        // Sort by rating descending for quality first
        listings.sort((a, b) => (b.rating || 0) - (a.rating || 0));

        const source = isMistral ? "mistral" : "smart_fallback";
        const result = { listings, rationale };
        await cacheService.set(resultKey, result, AI_RESULT_TTL);

        return { ...result, source };
    }

    /**
     * Recommendation engine: returns { recommendations, reasoning, source }
     *  Each item in recommendations has an extra `matchScore` and `matchReason`.
     */
    async getRecommendationsFromPastTrips(userId) {
        if (!userId) {
            const listings = await listingService.getFeaturedListings(6);
            return { recommendations: listings, reasoning: null, source: "featured" };
        }

        // Cache per user (30 min — shorter so new bookings shift recommendations)
        const recoKey = AI_RECO_RESULT_PFX + String(userId);
        const cached  = await cacheService.get(recoKey);
        if (cached) return { ...cached, source: "cache" };

        // 1. Fetch past confirmed / completed bookings (last 20 for token efficiency)
        const allBookings = await bookingRepository.findByGuest(userId);
        const bookings = allBookings
            .filter(b => ["CONFIRMED", "COMPLETED"].includes(b.status))
            .slice(0, 20);

        const profile = _buildTravellerProfile(bookings);

        // No booking history — return featured listings
        if (!profile) {
            const listings = await listingService.getFeaturedListings(6);
            return { recommendations: listings, reasoning: "No past trips yet — here are our top picks!", source: "featured" };
        }

        // 2. Ask Mistral to infer ranked preferences from the compact profile sentence
        let prefs = null;
        let reasoning = null;

        if (mistral.isEnabled) {
            try {
                const profilePrompt = _profileToPrompt(profile);
                prefs = await mistral.callJSON(RECO_SYSTEM_PROMPT, profilePrompt);
                reasoning = prefs.reasoning || null;
            } catch (err) {
                console.warn("[AI] Recommendation Mistral call failed:", err.message);
                // prefs stays null — scoring falls back to profile directly
            }
        }

        // 3. Query MongoDB: cast a wide net using top categories / amenities
        const filterCategories = (prefs?.preferredCategories || profile.topCategories).slice(0, 3);
        const filterAmenities  = (prefs?.mustHaveAmenities   || profile.topAmenities ).slice(0, 3);

        const candidateFilter = {};
        if (filterCategories.length) candidateFilter.category  = { $in: filterCategories };
        if (filterAmenities.length)  candidateFilter.amenities = { $in: filterAmenities };

        // Max price cap: 2× average nightly rate gives good variety
        if (profile.avgNightlyRate > 0) {
            candidateFilter.price = { $lte: profile.avgNightlyRate * 2 };
        }

        let candidates = await listingRepository.find(candidateFilter, null, 50);
        candidates.forEach(decorateRating);

        // Exclude listings the user has already booked
        const bookedIds = new Set(
            bookings.map(b => String(b.listingId?._id || b.listingId))
        );
        candidates = candidates.filter(c => !bookedIds.has(String(c._id)));

        // 4. Score every candidate locally — NO second LLM call
        const activePref = prefs || {
            preferredCategories: profile.topCategories,
            mustHaveAmenities:   profile.topAmenities,
            niceToHaveAmenities: [],
            priceRange: {
                min: Math.max(0, profile.avgNightlyRate * 0.5),
                max: profile.avgNightlyRate * 1.8
            }
        };

        const scored = candidates
            .map(l => ({
                ...l,
                matchScore: _scoreCandidate(l, activePref, profile)
            }))
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, 8);

        // 5. Attach a human-readable match reason per listing
        const vibeWords = prefs?.vibeKeywords || profile.topCategories.slice(0, 2);
        const recommendations = scored.map(l => {
            const reasons = [];
            if ((activePref.preferredCategories || []).includes(l.category)) {
                reasons.push(`Matches your love for ${l.category}`);
            }
            const sharedAmenities = (l.amenities || [])
                .filter(a => (activePref.mustHaveAmenities || []).includes(a));
            if (sharedAmenities.length) {
                reasons.push(`Has ${sharedAmenities.slice(0, 2).join(" & ")} you enjoy`);
            }
            if (l.price <= profile.avgNightlyRate * 1.1) {
                reasons.push("Fits your typical budget");
            }
            if ((l.rating || 0) >= 4.5) {
                reasons.push("Highly rated by guests");
            }
            return {
                ...l,
                matchReason: reasons.length
                    ? reasons.join(" · ")
                    : `Great ${vibeWords[0] || "stay"} pick for you`
            };
        });

        const result = { recommendations, reasoning };
        await cacheService.set(recoKey, result, AI_RESULT_TTL);

        return { ...result, source: prefs ? "mistral" : "heuristic" };
    }

    /** Invalidate a user's recommendation cache (call after a new booking) */
    async invalidateRecoCache(userId) {
        await cacheService.del(AI_RECO_RESULT_PFX + String(userId));
    }
}

module.exports = new AiService();
