const AppError = require("../../common/utils/AppError.js");

const VALID_TRANSITIONS = {
    "PENDING": ["CANCELLED"],
    "CONFIRMED": ["CANCELLED"],
    "CANCELLED": [],
    "EXPIRED": [],
    "COMPLETED": []
};

class BookingPolicy {
    canCreateBooking(listing, guestId) {
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }
        if (listing.owner && String(listing.owner) === String(guestId)) {
            throw new AppError(400, "You cannot book your own listing");
        }
        return true;
    }

    canUpdateStatus(booking, newStatus, actorId) {
        if (!booking) {
            throw new AppError(404, "Booking not found");
        }
        const currentStatus = booking.status;
        if (!VALID_TRANSITIONS[currentStatus] || !VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
            throw new AppError(400, `Invalid state transition from ${currentStatus} to ${newStatus}`);
        }
        const isGuest = String(actorId) === String(booking.guestId);
        if (!isGuest) {
            throw new AppError(403, "You are not authorized to update this booking");
        }
        if (newStatus !== "CANCELLED") {
            throw new AppError(403, "Guests can only cancel their own bookings");
        }
        return true;
    }
}

module.exports = new BookingPolicy();
