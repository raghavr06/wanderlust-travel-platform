const listingRepository = require("./listing.repository.js");
const { LISTING_AMENITIES } = require("./listing.model.js");
const cacheService = require("../../common/services/cache.service.js");
const AppError = require("../../common/utils/AppError.js");

function decorateRating(listing) {
    const reviews = listing.reviews || [];
    const valid = reviews.filter(r => r && typeof r.rating === "number");
    listing.numReviews = valid.length;
    listing.rating = valid.length
        ? Math.round((valid.reduce((s, r) => s + r.rating, 0) / valid.length) * 10) / 10
        : 0;
    delete listing.reviews;
    return listing;
}

function buildRooms(rooms, fallback) {
    if (Array.isArray(rooms) && rooms.length) {
        const cleaned = rooms
            .map(r => ({
                name: String(r.name || "").trim(),
                maxGuests: parseInt(r.maxGuests, 10) || 1,
                price: (r.price !== undefined && r.price !== null && r.price !== "" && Number(r.price) > 0)
                    ? Number(r.price)
                    : Number(fallback.price) || 0
            }))
            .filter(r => r.name);
        if (cleaned.length) return cleaned.slice(0, 5);
    }
    return [{
        name: "Standard Room",
        maxGuests: parseInt(fallback.maxGuests, 10) || 1,
        price: Number(fallback.price) || 0
    }];
}

function deriveListingLevel(rooms, basePrice, baseGuests) {
    const prices = rooms.map(r => r.price).filter(p => p > 0);
    const price = prices.length ? Math.min(basePrice, ...prices) : basePrice;
    const maxGuests = Math.max(parseInt(baseGuests, 10) || 1, rooms.reduce((s, r) => s + r.maxGuests, 0));
    return { price, maxGuests };
}

class ListingService {
    async getListings({ q, category, country, minPrice, maxPrice, sort, limit } = {}) {
        const cacheKey = `listings:q:${q || ""}:c:${category || ""}:co:${country || ""}:lo:${minPrice || ""}:hi:${maxPrice || ""}:s:${sort || ""}:l:${limit || ""}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return cached;

        const filter = {};
        if (category) filter.category = category;
        if (country) filter.country = country;
        if (q && q.trim()) {
            const regex = new RegExp(q.trim(), "i");
            filter.$or = [{ title: regex }, { location: regex }, { country: regex }];
        }
        if (minPrice !== undefined && minPrice !== null && minPrice !== "") {
            filter.price = { ...filter.price, $gte: Number(minPrice) };
        }
        if (maxPrice !== undefined && maxPrice !== null && maxPrice !== "") {
            filter.price = { ...filter.price, $lte: Number(maxPrice) };
        }

        const priceSort = sort === "price_asc" ? { price: 1 } : (sort === "price_desc" ? { price: -1 } : null);

        let listings = await listingRepository.find(filter, priceSort, limit);

        listings.forEach(decorateRating);

        if (sort === "rating") {
            listings.sort((a, b) => b.rating - a.rating);
            if (limit) listings = listings.slice(0, limit);
        }

        await cacheService.set(cacheKey, listings, 3600);
        return listings;
    }

    async getFeaturedListings(limit = 8) {
        return this.getListings({ sort: "rating", limit });
    }

    async getListingsByOwner(ownerId) {
        const cacheKey = `listings:owner:${ownerId}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return cached;

        const listings = await listingRepository.findByOwner(ownerId);
        await cacheService.set(cacheKey, listings, 3600);
        return listings;
    }

    async getListingById(id) {
        const cacheKey = `listings:${id}`;
        const cached = await cacheService.get(cacheKey);
        if (cached && cached.price !== undefined) return cached;

        const listing = await listingRepository.findByIdPopulated(id);
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }

        const raw = listing.toObject();
        decorateRating(raw);
        raw.owner = listing.owner;
        raw.reviews = listing.reviews;
        raw.blockedDates = listing.blockedDates || [];

        await cacheService.set(cacheKey, raw, 3600);
        return raw;
    }

    async invalidateCache() {
        await cacheService.clearPattern("listings:*");
    }

    async createListing(listingData, ownerId, file) {
        const cleanedData = { ...listingData };
        delete cleanedData.rooms;

        const basePrice = Number(listingData.price) || 0;
        const baseGuests = Number(listingData.maxGuests) || 1;
        const rooms = buildRooms(listingData.rooms, { price: basePrice, maxGuests: baseGuests });
        const { price, maxGuests } = deriveListingLevel(rooms, basePrice, baseGuests);
        cleanedData.rooms = rooms;
        cleanedData.price = price;
        cleanedData.maxGuests = maxGuests;
        cleanedData.owner = ownerId;

        if (file) {
            cleanedData.image = {
                url: file.path,
                filename: file.filename
            };
        }

        const newListing = await listingRepository.create(cleanedData);
        await this.invalidateCache();
        return newListing;
    }

    async updateListing(id, listingData, file) {
        let listing = await listingRepository.findById(id);
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }
        const cleanedData = { ...listingData };
        const roomsProvided = Array.isArray(listingData.rooms) && listingData.rooms.length;
        delete cleanedData.rooms;

        if (roomsProvided) {
            const fallback = {
                price: listingData.price != null && listingData.price !== "" ? Number(listingData.price) : (listing.price || 0),
                maxGuests: listingData.maxGuests || (listing.maxGuests || 1)
            };
            const rooms = buildRooms(listingData.rooms, fallback);
            const basePrice = Number(fallback.price) || 0;
            const { price, maxGuests } = deriveListingLevel(rooms, basePrice, fallback.maxGuests);
            cleanedData.rooms = rooms;
            cleanedData.price = price;
            cleanedData.maxGuests = maxGuests;
        }

        listing.set(cleanedData);
        if (file) {
            listing.image = {
                url: file.path,
                filename: file.filename
            };
        }
        await listing.save();
        await this.invalidateCache();
        return listing;
    }

    async deleteListing(id) {
        const deleted = await listingRepository.deleteById(id);
        if (!deleted) {
            throw new AppError(404, "Listing not found");
        }
        await this.invalidateCache();
        return deleted;
    }

    async addBlockedDates(id, dates) {
        const listing = await listingRepository.findById(id);
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }
        const normalized = dates.map(d => {
            const date = new Date(d);
            date.setHours(0, 0, 0, 0);
            return date;
        });
        const existing = (listing.blockedDates || []).map(d => new Date(d).setHours(0, 0, 0, 0));
        const toAdd = normalized.filter(d => !existing.includes(d.getTime()));
        if (toAdd.length === 0) return listing;
        listing.blockedDates = [...(listing.blockedDates || []), ...toAdd];
        await listing.save();
        await this.invalidateCache();
        return listing;
    }

    async removeBlockedDate(id, dateStr) {
        const target = new Date(dateStr).setHours(0, 0, 0, 0);
        const listing = await listingRepository.findById(id);
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }
        listing.blockedDates = (listing.blockedDates || []).filter(d => new Date(d).setHours(0, 0, 0, 0) !== target);
        await listing.save();
        await this.invalidateCache();
        return listing;
    }
}

module.exports = new ListingService();
module.exports.LISTING_AMENITIES = LISTING_AMENITIES;