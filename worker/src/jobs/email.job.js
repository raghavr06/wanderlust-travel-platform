async function processEmailJob(job) {
    console.log(`[bullmq] Email job received: ${job.name}`, job.data);
    return { ok: true, sent: true };
}

module.exports = {
    processEmailJob
};
