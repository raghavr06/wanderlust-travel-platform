const redis = require("redis");
const Redis = require("ioredis");
const redisConfig = require("../../config/redis");

const redisClient = redis.createClient({ url: redisConfig.url });
redisClient.on("error", (err) => console.error("Redis Client Error", err));

const ioRedisClient = new Redis(redisConfig.url, redisConfig.options);
ioRedisClient.on("error", (err) => console.error("IoRedis Client Error", err));

async function connectRedis() {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
}

module.exports = {
    redisClient,
    ioRedisClient,
    connectRedis
};
