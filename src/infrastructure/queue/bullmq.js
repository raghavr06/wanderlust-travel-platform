const { Queue } = require('bullmq');
const { ioRedisClient } = require('../redis/redis');

const bookingQueue = new Queue('booking-events', { connection: ioRedisClient });

module.exports = {
    bookingQueue
};
