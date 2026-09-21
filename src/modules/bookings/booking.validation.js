const Joi = require('joi');

module.exports.createBookingSchema = Joi.object({
    checkIn: Joi.date().iso().required(),
    checkOut: Joi.date().iso().required(),
    guests: Joi.number().integer().min(1).required(),
    roomId: Joi.string().optional()
});
