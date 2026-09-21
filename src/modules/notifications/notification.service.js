const notificationRepository = require("./notification.repository.js");

class NotificationService {
    async create({ recipient, type, title, message, link }) {
        if (!recipient) return null;
        try {
            return await notificationRepository.create({ recipient, type, title, message, link });
        } catch (err) {
            console.error("Failed to create notification:", err);
            return null;
        }
    }

    async listForUser(userId, { limit = 50, unreadOnly = false } = {}) {
        return notificationRepository.listForUser(userId, limit, unreadOnly);
    }

    async unreadCount(userId) {
        return notificationRepository.unreadCount(userId);
    }

    async markAllRead(userId) {
        return notificationRepository.markAllRead(userId);
    }

    async markRead(userId, notificationId) {
        return notificationRepository.markRead(userId, notificationId);
    }
}

module.exports = new NotificationService();