const mongoose = require("mongoose");
const bookingRepository = require("./booking.repository.js");
const availabilityService = require("./availability.service.js");
const bookingPolicy = require("./booking.policy.js");
const listingRepository = require("../listings/listing.repository.js");
const userRepository = require("../users/user.repository.js");
const AppError = require("../../common/utils/AppError.js");
const cacheService = require("../../common/services/cache.service.js");
const queueService = require("../../common/services/queue.service.js");
const notificationService = require("../notifications/notification.service.js");
const nuiteeClient = require("../../infrastructure/nuitee/nuitee.client.js");

const MAX_STAY_NIGHTS = 30;
const CHECK_IN_HOUR = 12;
const CHECK_OUT_HOUR = 10;

function nightsBetween(checkIn, checkOut) {
    return Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
}

function defaultRoom(listing) {
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
        const listing = await listingRepository.findById(listingId);
        bookingPolicy.canCreateBooking(listing, guestId);

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

        // Nuitee Live Booking Flow (3-Step API Execution)
        let nuiteeOfferId = null;
        let nuiteePrebookId = null;
        let nuiteeBookingId = null;

        if (listing.nuiteeHotelId) {
            try {
                // Step 1: Search Rates -> get offerId
                const ratesRes = await nuiteeClient.searchRates({
                    hotelId: listing.nuiteeHotelId,
                    checkIn: checkInStr,
                    checkOut: checkOutStr,
                    adultCount: guests
                });

                const roomTypes = ratesRes?.data?.[0]?.roomTypes || [];
                if (roomTypes.length > 0 && roomTypes[0].offerId) {
                    nuiteeOfferId = roomTypes[0].offerId;

                    // Step 2: Prebook -> get prebookId
                    const prebookRes = await nuiteeClient.prebook({ offerId: nuiteeOfferId });
                    nuiteePrebookId = prebookRes?.data?.prebookId || prebookRes?.prebookId;

                    if (nuiteePrebookId) {
                        // Step 3: Confirm Booking -> get confirmation
                        const confirmRes = await nuiteeClient.confirmBooking({
                            prebookId: nuiteePrebookId,
                            holder: {
                                firstName: "Guest",
                                lastName: "User",
                                email: "guest@wanderlust.dev",
                                phone: "1234567890"
                            },
                            guests: [{
                                occupancyNumber: 1,
                                firstName: "Guest",
                                lastName: "User",
                                email: "guest@wanderlust.dev"
                            }],
                            payment: { method: "ACC_CREDIT_CARD" }
                        });
                        nuiteeBookingId = confirmRes?.data?.bookingId || confirmRes?.bookingId || "nuitee_confirmed";
                    }
                }
            } catch (nuiteeErr) {
                console.warn("[Nuitee Integration Warning] 3-step live booking encountered an issue, proceeding with internal reservation:", nuiteeErr.message);
            }
        }

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                const txnListing = await listingRepository.findByIdInTxn(listingId, session);
                if (!txnListing) {
                    throw new AppError(404, "Listing not found");
                }

                const blocked = availabilityService.getBlockedOverlapForRange(txnListing, checkIn, checkOut);
                if (blocked) {
                    throw new AppError(409, "This listing is not available for the selected dates");
                }

                const overlappingBookings = await bookingRepository.findOverlapping(
                    listingId,
                    roomIdValue,
                    checkIn,
                    checkOut,
                    session
                );

                if (overlappingBookings.length > 0) {
                    throw new AppError(409, `"${room.name}" is already booked for part of those dates`);
                }

                await listingRepository.updateOne(
                    { _id: listingId },
                    { $inc: { lockVersion: 1 } },
                    { session }
                );

                const totalPrice = nights * roomPrice;

                const newBooking = await bookingRepository.createBookingDoc({
                    listingId,
                    guestId,
                    checkIn,
                    checkOut,
                    guests,
                    roomId: roomIdValue,
                    roomName: room.name,
                    totalPrice,
                    status: "CONFIRMED",
                    nuiteeOfferId,
                    nuiteePrebookId,
                    nuiteeBookingId
                }, session);

                await session.commitTransaction();

                await cacheService.del(`listings:${listingId}`);
                await cacheService.del("listings:all");

                await queueService.enqueueConfirmedBooking(newBooking._id);

                const guest = await userRepository.findById(guestId, "username");

                await notificationService.create({
                    recipient: txnListing.owner,
                    type: "NEW_BOOKING",
                    title: "New booking",
                    message: `${guest?.username || "A guest"} booked "${txnListing.title}" (${room.name}) from ${checkIn.toLocaleDateString()} to ${checkOut.toLocaleDateString()}.`,
                    link: "/dashboard"
                });

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
            const booking = await bookingRepository.findById(bookingId, session);
            bookingPolicy.canUpdateStatus(booking, newStatus, actorId);

            const listing = await listingRepository.findByIdInTxn(booking.listingId, session);

            booking.status = newStatus;
            await booking.save({ session });

            await session.commitTransaction();

            await cacheService.del(`listings:${booking.listingId}`);

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
        return availabilityService.getBookedDates(listingId, roomId);
    }

    async getAvailability(listingId) {
        return availabilityService.getAvailability(listingId);
    }

    async getBlockedOverlapForRange(listing, checkIn, checkOut) {
        return availabilityService.getBlockedOverlapForRange(listing, checkIn, checkOut);
    }

    async getBookingsByGuest(guestId) {
        return bookingRepository.findByGuest(guestId);
    }

    async getBookingRequestsByHost(hostId, { status } = {}) {
        const listings = await listingRepository.selectOwnerListings(hostId);
        const listingIds = listings.map(l => l._id);
        if (listingIds.length === 0) return { listings: [], requests: [] };
        const requests = await bookingRepository.findByListings(listingIds, status);
        return { listings, requests };
    }
}

module.exports = new BookingService();