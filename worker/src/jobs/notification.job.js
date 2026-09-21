const Booking = require('../../../src/modules/bookings/booking.model.js');
const Listing = require('../../../src/modules/listings/listing.model.js');

async function processNotificationJob(job) {
    if (job.name !== 'booking-confirmed') return;
    const { bookingId } = job.data;
    const booking = await Booking.findById(bookingId).lean();
    const listing = booking ? await Listing.findById(booking.listingId).select("title").lean() : null;
    if (booking && listing) {
        console.log(`[bullmq] booking-confirmed: #${bookingId} ${listing.title} (${booking.roomName || "room"}) for ${booking.guests} guest(s), nights=${Math.ceil((booking.checkOut - booking.checkIn) / 86400000)}`);
    } else {
        console.log(`[bullmq] booking-confirmed: #${bookingId} (booking/listing no longer exists)`);
    }
    return { ok: true, bookingId };
}

module.exports = {
    processNotificationJob
};
