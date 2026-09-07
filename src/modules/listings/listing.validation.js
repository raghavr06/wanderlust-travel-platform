const Joi = require('joi');
const { LISTING_CATEGORIES, LISTING_AMENITIES } = require('./listing.model.js');

module.exports.listingSchema = Joi.object({
    listing: Joi.object({
        title: Joi.string().trim().required(),
        description: Joi.string().trim().required(),
        location: Joi.string().trim().required(),
        country: Joi.string().trim().required(),
        price: Joi.number().required().min(0),
        category: Joi.string().valid(...LISTING_CATEGORIES).default("Rooms"),
        amenities: Joi.array().items(Joi.string().valid(...LISTING_AMENITIES)).unique().default([]),
        maxGuests: Joi.number().integer().min(1).default(1),
        rooms: Joi.array().max(5).items(
            Joi.object({
                name: Joi.string().trim().min(1).max(80),
                maxGuests: Joi.number().integer().min(1).max(20),
                price: Joi.number().min(0).allow(null, "")
            })
        ).optional(),
        image: Joi.object({
            filename: Joi.string().allow("", null),
            url: Joi.string().allow("", null)
        }).optional()
    }).required()
});