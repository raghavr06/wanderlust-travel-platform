const Redis = require('ioredis');

class CacheService {
    constructor() {
        // If testing or redis not available, we could handle gracefully, but assuming it's available.
        this.redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
        this.redis.on('error', (err) => console.error('Redis Client Error', err));
    }

    async get(key) {
        try {
            const data = await this.redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (err) {
            console.error('Redis Get Error:', err);
            return null; // Fallback to DB if cache fails
        }
    }

    async set(key, value, expirationSeconds = 3600) {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', expirationSeconds);
        } catch (err) {
            console.error('Redis Set Error:', err);
        }
    }

    async del(key) {
        try {
            await this.redis.del(key);
        } catch (err) {
            console.error('Redis Del Error:', err);
        }
    }

    async clearPattern(pattern) {
        try {
            const keys = await this.redis.keys(pattern);
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } catch (err) {
            console.error('Redis Clear Pattern Error:', err);
        }
    }
}

module.exports = new CacheService();
