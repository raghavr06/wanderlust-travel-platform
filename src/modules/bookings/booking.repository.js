const Booking = require("./booking.model.js");

class BookingRepository {
    async findById(id, session = null) {
        let query = Booking.findById(id);
        if (session) query = query.session(session);
        return query;
    }

    async findOverlapping(listingId, roomId, checkIn, checkOut, session = null) {
        let query = Booking.find({
            listingId,
            roomId,
            status: { $in: ["PENDING", "CONFIRMED"] },
            checkIn: { $lt: checkOut },
            checkOut: { $gt: checkIn }
        });
        if (session) query = query.session(session);
        return query;
    }

    async createBookingDoc(bookingData, session = null) {
        const booking = new Booking(bookingData);
        if (session) {
            await booking.save({ session });
        } else {
            await booking.save();
        }
        return booking;
    }

    async findBookedDates(query) {
        return Booking.find(query).select("checkIn checkOut roomId roomName -_id");
    }

    async findByGuest(guestId) {
        return Booking.find({ guestId })
            .populate("listingId", "title image country location")
            .sort({ createdAt: -1 });
    }

    async findByListings(listingIds, status = null) {
        const query = { listingId: { $in: listingIds } };
        if (status) query.status = status;
        return Booking.find(query)
            .populate("guestId", "username")
            .populate("listingId", "title image")
            .sort({ createdAt: -1 });
    }
}

module.exports = new BookingRepository();
