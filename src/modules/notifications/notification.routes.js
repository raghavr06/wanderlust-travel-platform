const express = require("express");
const router = express.Router();
const { isLoggedIn } = require("../../common/middlewares/auth.middleware.js");
const notificationController = require("./notification.controller.js");

router.get("/", isLoggedIn, notificationController.index);
router.post("/read-all", isLoggedIn, notificationController.markAllRead);
router.post("/:id/read", isLoggedIn, notificationController.markRead);

module.exports = router;