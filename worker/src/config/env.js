require('dotenv').config();

module.exports = {
    env: process.env.NODE_ENV || 'development',
    mongoUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/wanderlust',
    redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
};
