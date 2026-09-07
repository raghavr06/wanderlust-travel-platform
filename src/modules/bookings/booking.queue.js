const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const Booking = require('./booking.model.js');
const Listing = require('../listings/listing.model.js');

const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null // Required by bullmq
});

const bookingQueue = new Queue('booking-events', { connection });

// Enqueue a job right after a booking is instantly confirmed.
const enqueueConfirmedBooking = async (bookingId) => {
    await bookingQueue.add('booking-confirmed', { bookingId });
};

// Worker that picks up confirmed-booking jobs (here it emulates building a
// confirmation "email" / downstream side-effect so BullMQ is observable in prod).
if (process.env.NODE_ENV !== 'test') {
    const worker = new Worker('booking-events', async job => {
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
    }, { connection });

    worker.on('completed', (job) => {
        console.log(`[bullmq] job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[bullmq] job ${job.id} failed with ${err.message}`);
    });
}

module.exports = { enqueueConfirmedBooking, bookingQueue };