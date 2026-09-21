"use strict";
const aiService = require("./ai.service.js");

/**
 * GET /ai
 * Renders the AI search/recommendation landing page.
 */
module.exports.index = async (req, res) => {
    res.render("ai/index.ejs", {
        results: null,
        recommendations: null,
        query: "",
        rationale: null,
        reasoning: null,
        source: null,
        mode: "search"
    });
};

/**
 * GET /ai/search?q=romantic+stay+near+hills
 * Returns AI-powered listing results as a page render.
 */
module.exports.search = async (req, res) => {
    const query = (req.query.q || "").trim();

    const { listings, rationale, source } = await aiService.searchListingsWithAI(query);

    res.render("ai/index.ejs", {
        results: listings,
        recommendations: null,
        query,
        rationale,
        reasoning: null,
        source,
        mode: "search"
    });
};

/**
 * GET /ai/recommendations
 * Returns personalised recommendations based on the logged-in user's past trips.
 * Requires login; falls back to featured listings if not authenticated.
 */
module.exports.recommendations = async (req, res) => {
    const userId = req.user?._id || null;

    const { recommendations, reasoning, source } =
        await aiService.getRecommendationsFromPastTrips(userId);

    res.render("ai/index.ejs", {
        results: null,
        recommendations,
        query: "",
        rationale: null,
        reasoning,
        source,
        mode: "recommendations"
    });
};
