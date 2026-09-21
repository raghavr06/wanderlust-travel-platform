const mongoose = require('mongoose');
const env = require('./config/env');
const { createWorker } = require('./infrastructure/bullmq');

async function startWorkerProcess() {
    try {
        await mongoose.connect(env.mongoUrl);
        console.log("Worker connected to MongoDB");

        const worker = createWorker();
        console.log("Worker service running, listening for job events...");

        const shutdown = async (signal) => {
            console.log(`\nWorker received ${signal}. Closing...`);
            await worker.close();
            await mongoose.disconnect();
            process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (err) {
        console.error("Failed to start worker:", err);
        process.exit(1);
    }
}

if (require.main === module) {
    startWorkerProcess();
}

module.exports = { startWorkerProcess };
