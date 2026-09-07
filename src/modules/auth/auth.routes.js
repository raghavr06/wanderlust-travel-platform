const express = require("express");
const router = express.Router({ mergeParams: true });
const User = require("../users/user.model.js");
const wrapAsync = require("../../common/utils/wrapAsync.js");
const passport = require("passport");
const { saveRedirectUrl, isLoggedIn } = require("../../common/middlewares/auth.middleware.js");
const userController = require("./auth.controller.js");

router.route("/signup")
        .get(userController.renderSignupForm)
        .post(wrapAsync(userController.signUp));

router.route("/login")
        .get(userController.renderLoginForm)
        .post(saveRedirectUrl, passport.authenticate("local", { failureRedirect: "/login", failureFlash: true }), userController.login);

router.get("/logout", userController.logout);

router.get("/profile", isLoggedIn, wrapAsync(userController.renderProfile));
router.post("/profile/bookings/:bookingId/cancel", isLoggedIn, wrapAsync(userController.cancelBooking));

router.get("/dashboard", isLoggedIn, wrapAsync(userController.renderDashboard));

module.exports = router;