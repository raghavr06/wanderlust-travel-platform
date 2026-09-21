const env = require('./env');

module.exports = {
    url: env.redisUrl,
    options: {
        maxRetriesPerRequest: null // Required by BullMQ
    }
};
