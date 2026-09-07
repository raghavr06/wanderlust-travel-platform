const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const bookingSchema = new Schema({
    listingId: {
        type: Schema.Types.ObjectId,
        ref: "Listing",
        required: true
    },
    guestId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    checkIn: {
        type: Date,
        required: true
    },
    checkOut: {
        type: Date,
        required: true
    },
    guests: {
        type: Number,
        required: true,
        min: 1
    },
    roomId: {
        type: Schema.Types.ObjectId,
        required: true
    },
    roomName: {
        type: String,
        default: ""
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED"],
        default: "CONFIRMED",
        required: true
    }
}, { timestamps: true });

// Crucial compound index for fast availability queries (per room)
bookingSchema.index({ listingId: 1, roomId: 1, status: 1, checkIn: 1, checkOut: 1 });
// For guest/host dashboards
bookingSchema.index({ guestId: 1, createdAt: -1 });
bookingSchema.index({ listingId: 1, createdAt: -1 });

const Booking = mongoose.model("Booking", bookingSchema);
module.exports = Booking;
