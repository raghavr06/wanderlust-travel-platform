const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../../common/utils/wrapAsync.js");
const { isLoggedIn } = require("../../common/middlewares/auth.middleware.js");
const bookingController = require("./booking.controller.js");

// Create a booking for a specific listing (auto-confirmed if available)
router.post("/", isLoggedIn, wrapAsync(bookingController.createBooking));

// Get availability (per-room booked + listing blocked ranges) for the booking calendar
router.get("/availability", wrapAsync(bookingController.getAvailability));

// Get booked dates for flatpickr calendar (backwards compatible)
router.get("/booked-dates", wrapAsync(bookingController.getBookedDates));

module.exports = router;