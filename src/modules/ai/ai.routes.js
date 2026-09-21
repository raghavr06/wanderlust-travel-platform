"use strict";
const express    = require("express");
const router     = express.Router();
const controller = require("./ai.controller.js");

// GET /ai               — landing page
router.get("/",                controller.index);

// GET /ai/search?q=...  — natural-language search
router.get("/search",          controller.search);

// GET /ai/recommendations — personalised recommendations
router.get("/recommendations", controller.recommendations);

module.exports = router;
