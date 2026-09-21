const { Worker } = require('bullmq');
const { connection } = require('./redis');
const { processNotificationJob } = require('../jobs/notification.job');
const { processEmailJob } = require('../jobs/email.job');

function createWorker() {
    const worker = new Worker('booking-events', async (job) => {
        if (job.name === 'booking-confirmed') {
            return processNotificationJob(job);
        } else if (job.name === 'send-email') {
            return processEmailJob(job);
        }
    }, { connection });

    worker.on('completed', (job) => {
        console.log(`[bullmq-worker] Job ${job.id} (${job.name}) completed`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[bullmq-worker] Job ${job.id} (${job.name}) failed with ${err.message}`);
    });

    return worker;
}

module.exports = {
    createWorker
};
