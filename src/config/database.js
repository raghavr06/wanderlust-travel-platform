const env = require('./env');

module.exports = {
    url: env.mongoUrl,
    options: {
        // Additional Mongoose connection options can be specified here
    }
};
