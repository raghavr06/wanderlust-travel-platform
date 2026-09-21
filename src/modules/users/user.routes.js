const express = require("express");
const router = express.Router();
const { isLoggedIn } = require("../../common/middlewares/auth.middleware.js");
const userController = require("./user.controller.js");
const wrapAsync = require("../../common/utils/wrapAsync.js");

router.get("/me", isLoggedIn, wrapAsync(userController.getProfile));

module.exports = router;
