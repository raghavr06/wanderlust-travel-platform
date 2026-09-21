const Joi = require('joi');

module.exports.notificationSchema = Joi.object({
    recipient: Joi.string().required(),
    type: Joi.string().valid("BOOKING_REQUEST", "BOOKING_CONFIRMED", "NEW_BOOKING", "BOOKING_CANCELLED", "BOOKING_EXPIRED", "REVIEW", "SYSTEM").required(),
    title: Joi.string().required(),
    message: Joi.string().required(),
    link: Joi.string().optional()
});
