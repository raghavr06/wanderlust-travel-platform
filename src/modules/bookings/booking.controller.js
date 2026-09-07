const bookingService = require("./booking.service.js");

function parsePositiveInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports.createBooking = async (req, res) => {
    let { listingId } = req.params;
    let { checkIn, checkOut, roomId } = req.body;
    let guests = parsePositiveInt(req.body.guests);
    let guestId = req.user._id;

    try {
        await bookingService.createBooking(listingId, guestId, checkIn, checkOut, guests, roomId);
        req.flash("success", "Booking confirmed! The host has been notified.");
    } catch (err) {
        const message = err.statusCode && err.statusCode < 500 ? err.message : "Something went wrong while booking.";
        req.flash("error", message);
    }

    const redirectTo = `${req.get("Referer") || `/listings/${listingId}`}`;
    res.redirect(redirectTo.split("?")[0]);
};

module.exports.getBookedDates = async (req, res) => {
    let { listingId } = req.params;
    const bookedDates = await bookingService.getBookedDates(listingId);
    res.json(bookedDates);
};

module.exports.getAvailability = async (req, res) => {
    let { listingId } = req.params;
    const availability = await bookingService.getAvailability(listingId);
    res.json({ rooms: availability.rooms, blocked: availability.blockedDates });
};