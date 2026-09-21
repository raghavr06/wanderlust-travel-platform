const Notification = require("./notification.model.js");

class NotificationRepository {
    async create(notificationData) {
        return Notification.create(notificationData);
    }

    async listForUser(userId, limit = 50, unreadOnly = false) {
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
        return Notification.updateMany({ recipient: userId, read: false }, { $set: { read: true } });
    }

    async markRead(userId, notificationId) {
        return Notification.updateOne(
            { _id: notificationId, recipient: userId },
            { $set: { read: true } }
        );
    }
}

module.exports = new NotificationRepository();
