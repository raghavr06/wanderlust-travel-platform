const Listing = require("./listing.model.js");

class ListingRepository {
    async find(filter = {}, priceSort = null, limit = null) {
        let cursor = Listing.find(filter).populate("reviews").lean();
        if (priceSort) cursor = cursor.sort(priceSort);
        if (limit && priceSort) cursor = cursor.limit(limit);
        return cursor;
    }

    async findByOwner(ownerId) {
        return Listing.find({ owner: ownerId }).lean();
    }

    async findById(id) {
        return Listing.findById(id);
    }

    async findByIdPopulated(id) {
        return Listing.findById(id)
            .populate({ path: "reviews", populate: { path: "author" } })
            .populate("owner");
    }

    async findByIdInTxn(id, session) {
        return Listing.findById(id).session(session);
    }

    async create(listingData) {
        const listing = new Listing(listingData);
        return listing.save();
    }

    async deleteById(id) {
        return Listing.findByIdAndDelete(id);
    }

    async updateOne(filter, update, options = {}) {
        return Listing.updateOne(filter, update, options);
    }

    async selectOwnerListings(hostId) {
        return Listing.find({ owner: hostId }).select("_id");
    }
}

module.exports = new ListingRepository();
