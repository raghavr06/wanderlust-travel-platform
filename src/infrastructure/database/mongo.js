const mongoose = require('mongoose');
const dbConfig = require('../../config/database');

async function connectDB() {
    try {
        await mongoose.connect(dbConfig.url, dbConfig.options);
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error("MongoDB connection error:", err);
        throw err;
    }
}

async function disconnectDB() {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
}

module.exports = {
    connectDB,
    disconnectDB
};
