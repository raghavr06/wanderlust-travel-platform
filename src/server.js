const env = require('./config/env');
const app = require('./app');
const { connectDB, disconnectDB } = require('./infrastructure/database/mongo');
const { connectRedis } = require('./infrastructure/redis/redis');

async function startServer() {
    try {
        await connectDB();
        await connectRedis();

        const server = app.listen(env.port, () => {
            console.log(`Server listening on port ${env.port} [${env.env}]`);
        });

        const shutdown = async (signal) => {
            console.log(`\nReceived ${signal}. Shutting down gracefully...`);
            server.close(async () => {
                console.log('HTTP server closed.');
                await disconnectDB();
                process.exit(0);
            });
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { startServer };
