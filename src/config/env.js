require('dotenv').config();

module.exports = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 8080,
    mongoUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/wanderlust',
    redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    sessionSecret: process.env.SESSION_SECRET || 'local-dev-only-session-secret',
    cloudinary: {
        cloudName: process.env.CLOUD_NAME,
        apiKey: process.env.CLOUD_API_KEY,
        apiSecret: process.env.CLOUD_API_SECRET
    },
    nuitee: {
        apiKey: process.env.NUITEE_API_KEY,
        apiUrl: process.env.NUITEE_API_URL || 'https://api.liteapi.travel/v3.0'
    },
    mistral: {
        apiKey: (process.env.MISTRAL_API_KEY || "").trim() || null,
        model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
        maxTokens: parseInt(process.env.MISTRAL_MAX_TOKENS, 10) || 300,
        // 50k TPM hard cap — leave headroom for concurrent requests
        tpmLimit: parseInt(process.env.MISTRAL_TPM_LIMIT, 10) || 50000
    }
};
