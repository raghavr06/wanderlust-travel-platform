const { bookingQueue } = require('../../infrastructure/queue/bullmq');

class QueueService {
    async enqueueConfirmedBooking(bookingId) {
        await bookingQueue.add('booking-confirmed', { bookingId });
    }
}

module.exports = new QueueService();
