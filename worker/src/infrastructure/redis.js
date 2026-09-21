const Redis = require('ioredis');
const env = require('../config/env');

const connection = new Redis(env.redisUrl, {
    maxRetriesPerRequest: null
});

connection.on('error', (err) => console.error('Worker Redis Connection Error:', err));

module.exports = {
    connection
};
