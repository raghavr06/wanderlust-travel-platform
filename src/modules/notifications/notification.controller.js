const notificationService = require("./notification.service.js");

module.exports.index = async (req, res) => {
    const notifications = await notificationService.listForUser(req.user._id);
    res.render("./notifications/index.ejs", { notifications });
};

module.exports.markAllRead = async (req, res) => {
    await notificationService.markAllRead(req.user._id);
    res.redirect("/notifications");
};

module.exports.markRead = async (req, res) => {
    await notificationService.markRead(req.user._id, req.params.id);
    res.redirect("/notifications");
};