const Notification = require("./notification.model.js");

class NotificationService {
    async create({ recipient, type, title, message, link }) {
        if (!recipient) return null;
        try {
            return await Notification.create({ recipient, type, title, message, link });
        } catch (err) {
            console.error("Failed to create notification:", err);
            return null;
        }
    }

    async listForUser(userId, { limit = 50, unreadOnly = false } = {}) {
        const query = { recipient: userId };
        if (unreadOnly) query.read = false;
        return Notification.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }

    async unreadCount(userId) {
        if (!userId) return 0;
        return Notification.countDocuments({ recipient: userId, read: false });
    }

    async markAllRead(userId) {
        await Notification.updateMany({ recipient: userId, read: false }, { $set: { read: true } });
    }

    async markRead(userId, notificationId) {
        await Notification.updateOne(
            { _id: notificationId, recipient: userId },
            { $set: { read: true } }
        );
    }
}

module.exports = new NotificationService();