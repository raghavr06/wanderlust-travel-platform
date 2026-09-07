// Express 5 natively catches async errors and forwards to next(err).
// This wrapper is kept for backward compatibility but is now a no-op.
module.exports = (fn) => fn;