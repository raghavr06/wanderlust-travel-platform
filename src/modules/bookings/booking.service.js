const mongoose = require("mongoose");
const Booking = require("./booking.model.js");
const Listing = require("../listings/listing.model.js");
const AppError = require("../../common/utils/AppError.js");
const cacheService = require("../../common/services/cache.service.js");
const notificationService = require("../notifications/notification.service.js");

const MAX_STAY_NIGHTS = 30;

// Property rules: guests may check in from 12:00 PM on their check-in date and must
// check out by 10:00 AM on their check-out date. This means a room that a guest
// leaves at 10:00 AM is bookable again by the next guest at 12:00 PM the same day.
const CHECK_IN_HOUR = 12;
const CHECK_OUT_HOUR = 10;

const VALID_TRANSITIONS = {
    "PENDING": ["CANCELLED"], // legacy rows only
    "CONFIRMED": ["CANCELLED"],
    "CANCELLED": [],
    "EXPIRED": [],
    "COMPLETED": []
};

function yyyymmdd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function nightsBetween(checkIn, checkOut) {
    return Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
}

function defaultRoom(listing) {
    // Stable pseudo-id (the listing itself acts as the only "room")
    return {
        _id: listing._id,
        name: "Standard Room",
        maxGuests: listing.maxGuests || 1,
        price: listing.price || 0
    };
}

function resolveRoom(listing, roomId) {
    const rooms = (listing.rooms && listing.rooms.length) ? listing.rooms : [defaultRoom(listing)];
    if (!roomId) return rooms[0];
    const match = rooms.find(r => String(r._id) === String(roomId));
    return match || null;
}

class BookingService {
    async createBooking(listingId, guestId, checkInStr, checkOutStr, guests, roomId) {
        const listing = await Listing.findById(listingId);
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }
        if (listing.owner && String(listing.owner) === String(guestId)) {
            throw new AppError(400, "You cannot book your own listing");
        }

        const checkIn = new Date(`${checkInStr}T${String(CHECK_IN_HOUR).padStart(2, "0")}:00:00`);
        const checkOut = new Date(`${checkOutStr}T${String(CHECK_OUT_HOUR).padStart(2, "0")}:00:00`);

        if (isNaN(checkIn) || isNaN(checkOut)) {
            throw new AppError(400, "Invalid dates. Please select both check-in and check-out.");
        }
        if (checkIn >= checkOut) {
            throw new AppError(400, "Check-out date must be after check-in date");
        }
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        if (checkIn.getTime() < startOfToday.getTime()) {
            throw new AppError(400, "Check-in date cannot be in the past");
        }
        const nights = nightsBetween(checkIn, checkOut);
        if (nights < 1 || nights > MAX_STAY_NIGHTS) {
            throw new AppError(400, `Stay must be between 1 and ${MAX_STAY_NIGHTS} nights`);
        }

        const room = resolveRoom(listing, roomId);
        if (!room) {
            throw new AppError(400, "Selected room is no longer available");
        }
        if (!Number.isInteger(guests) || guests < 1 || guests > (room.maxGuests || 1)) {
            throw new AppError(400, `Guests must be between 1 and ${room.maxGuests} for "${room.name}"`);
        }
        const roomPrice = (room.price != null && room.price > 0) ? room.price : (listing.price || 0);
        const roomIdValue = room._id;

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                // Re-fetch listing inside the transaction for a consistent lockVersion check
                const txnListing = await Listing.findById(listingId).session(session);
                if (!txnListing) {
                    throw new AppError(404, "Listing not found");
                }

                // Check host-blocked dates (listing level)
                const blocked = await this.getBlockedOverlapForRange(txnListing, checkIn, checkOut);
                if (blocked) {
                    throw new AppError(409, "This listing is not available for the selected dates");
                }

                // 2. Check availability for the exact room (interval overlap)
                const overlappingBookings = await Booking.find({
                    listingId,
                    roomId: roomIdValue,
                    status: { $in: ["PENDING", "CONFIRMED"] },
                    checkIn: { $lt: checkOut },
                    checkOut: { $gt: checkIn }
                }).session(session);

                if (overlappingBookings.length > 0) {
                    throw new AppError(409, `"${room.name}" is already booked for part of those dates`);
                }

                // 3. Force Write Conflict by locking parent Listing Document
                await Listing.updateOne(
                    { _id: listingId },
                    { $inc: { lockVersion: 1 } },
                    { session }
                );

                const totalPrice = nights * roomPrice;

                const newBooking = new Booking({
                    listingId,
                    guestId,
                    checkIn,
                    checkOut,
                    guests,
                    roomId: roomIdValue,
                    roomName: room.name,
                    totalPrice,
                    status: "CONFIRMED"
                });

                await newBooking.save({ session });

                await session.commitTransaction();

                await cacheService.del(`listings:${listingId}`);
                await cacheService.del("listings:all");

                const { enqueueConfirmedBooking } = require('./booking.queue.js');
                await enqueueConfirmedBooking(newBooking._id);

                const User = require("../users/user.model.js");
                const guest = await User.findById(guestId).select("username").lean();

                // Notify host of the new confirmed booking
                await notificationService.create({
                    recipient: txnListing.owner,
                    type: "NEW_BOOKING",
                    title: "New booking",
                    message: `${guest?.username || "A guest"} booked "${txnListing.title}" (${room.name}) from ${checkIn.toLocaleDateString()} to ${checkOut.toLocaleDateString()}.`,
                    link: "/dashboard"
                });

                // Notify guest that it's instantly confirmed
                await notificationService.create({
                    recipient: guestId,
                    type: "BOOKING_CONFIRMED",
                    title: "Booking confirmed",
                    message: `Your booking for "${txnListing.title}" (${room.name}) from ${checkIn.toLocaleDateString()} to ${checkOut.toLocaleDateString()} is confirmed.`,
                    link: "/profile"
                });

                return newBooking;
            } catch (error) {
                await session.abortTransaction();

                if (
                    (error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError')) ||
                    error.code === 112
                ) {
                    if (attempt === maxRetries) {
                        throw new AppError(409, "High concurrency. Please try again later.");
                    }
                    await new Promise(resolve => setTimeout(resolve, attempt * 100));
                    continue;
                }

                throw error;
            } finally {
                session.endSession();
            }
        }
    }

    async updateBookingStatus(bookingId, newStatus, actorId) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const booking = await Booking.findById(bookingId).session(session);
            if (!booking) {
                throw new AppError(404, "Booking not found");
            }
            const listing = await Listing.findById(booking.listingId).session(session);

            const currentStatus = booking.status;
            if (!VALID_TRANSITIONS[currentStatus] || !VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
                throw new AppError(400, `Invalid state transition from ${currentStatus} to ${newStatus}`);
            }

            const isGuest = String(actorId) === String(booking.guestId);
            if (!isGuest) {
                throw new AppError(403, "You are not authorized to update this booking");
            }
            if (newStatus !== "CANCELLED") {
                throw new AppError(403, "Guests can only cancel their own bookings");
            }

            booking.status = newStatus;
            await booking.save({ session });

            await session.commitTransaction();

            await cacheService.del(`listings:${booking.listingId}`);

            // Notify the host about the cancellation
            if (listing?.owner) {
                await notificationService.create({
                    recipient: listing.owner,
                    type: "BOOKING_CANCELLED",
                    title: "Booking cancelled",
                    message: `A booking for "${listing.title}" (${booking.roomName || "room"}) from ${booking.checkIn.toLocaleDateString()} to ${booking.checkOut.toLocaleDateString()} was cancelled.`,
                    link: "/dashboard"
                });
            }

            return booking;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    async getBookedDates(listingId, roomId) {
        const query = {
            listingId,
            status: { $in: ["PENDING", "CONFIRMED"] },
            checkOut: { $gt: new Date() }
        };
        if (roomId) query.roomId = roomId;
        return Booking.find(query).select("checkIn checkOut roomId roomName -_id");
    }

    async getAvailability(listingId) {
        const listing = await Listing.findById(listingId);
        if (!listing) {
            return { rooms: [], blockedDates: [] };
        }
        const rooms = (listing.rooms && listing.rooms.length) ? listing.rooms : [defaultRoom(listing)];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const roomResults = [];
        for (const room of rooms) {
            const booked = await this.getBookedDates(listingId, room._id);
            roomResults.push({
                _id: room._id,
                name: room.name,
                maxGuests: room.maxGuests,
                price: (room.price != null && room.price > 0) ? room.price : (listing?.price || 0),
                disabled: booked.map(b => {
                    // A booking owns the nights [checkIn .. checkOut - 1]. The checkout
                    // day is free again from 10:00 AM, so it must NOT be greyed out.
                    const lastOccupied = new Date(b.checkOut);
                    lastOccupied.setDate(lastOccupied.getDate() - 1);
                    return { from: yyyymmdd(new Date(b.checkIn)), to: yyyymmdd(lastOccupied) };
                })
            });
        }

        const blockedDates = (listing.blockedDates || [])
            .filter(d => new Date(d) >= today)
            .map(d => ({ from: yyyymmdd(new Date(d)), to: yyyymmdd(new Date(d)) }));

        return { rooms: roomResults, blockedDates };
    }

    async getBlockedOverlapForRange(listing, checkIn, checkOut) {
        return listing.blockedDates?.some(d => {
            const date = new Date(d);
            date.setHours(0, 0, 0, 0);
            const ci = new Date(checkIn);
            ci.setHours(0, 0, 0, 0);
            const co = new Date(checkOut);
            co.setHours(0, 0, 0, 0);
            return date < co && date >= ci;
        }) || false;
    }

    async getBookingsByGuest(guestId) {
        return Booking.find({ guestId })
            .populate("listingId", "title image country location")
            .sort({ createdAt: -1 });
    }

    async getBookingRequestsByHost(hostId, { status } = {}) {
        const listings = await Listing.find({ owner: hostId }).select("_id");
        const listingIds = listings.map(l => l._id);
        if (listingIds.length === 0) return { listings: [], requests: [] };
        const query = { listingId: { $in: listingIds } };
        if (status) query.status = status;
        const requests = await Booking.find(query)
            .populate("guestId", "username")
            .populate("listingId", "title image")
            .sort({ createdAt: -1 });
        return { listings, requests };
    }
}

module.exports = new BookingService();