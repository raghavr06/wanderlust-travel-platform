const bookingRepository = require("./booking.repository.js");
const listingRepository = require("../listings/listing.repository.js");

function yyyymmdd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function defaultRoom(listing) {
    return {
        _id: listing._id,
        name: "Standard Room",
        maxGuests: listing.maxGuests || 1,
        price: listing.price || 0
    };
}

class AvailabilityService {
    async getBookedDates(listingId, roomId) {
        const query = {
            listingId,
            status: { $in: ["PENDING", "CONFIRMED"] },
            checkOut: { $gt: new Date() }
        };
        if (roomId) query.roomId = roomId;
        return bookingRepository.findBookedDates(query);
    }

    async getAvailability(listingId) {
        const listing = await listingRepository.findById(listingId);
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

    getBlockedOverlapForRange(listing, checkIn, checkOut) {
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
}

module.exports = new AvailabilityService();
