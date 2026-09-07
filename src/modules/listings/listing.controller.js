const listingService = require("./listing.service.js");
const bookingService = require("../bookings/booking.service.js");

const categoryMeta = [
    { name: "Rooms", icon: "fa-solid fa-bed" },
    { name: "Iconic Cities", icon: "fa-solid fa-city" },
    { name: "Mountains", icon: "fa-solid fa-mountain" },
    { name: "Castles", icon: "fa-brands fa-fort-awesome" },
    { name: "Amazing Pools", icon: "fa-solid fa-person-swimming" },
    { name: "Camping", icon: "fa-solid fa-campground" },
    { name: "Farms", icon: "fa-solid fa-cow" },
    { name: "Arctic", icon: "fa-solid fa-snowflake" },
    { name: "Domes", icon: "fa-solid fa-landmark-dome" },
    { name: "Boats", icon: "fa-solid fa-sailboat" }
];

module.exports.index = async (req, res) => {
    const { q, category, country, sort, minPrice, maxPrice } = req.query;
    const allListings = await listingService.getListings({ q, category, country, minPrice, maxPrice, sort });
    res.render("./listings/index.ejs", {
        allListings,
        categoryMeta,
        filters: { q, category, country, sort, minPrice, maxPrice }
    });
};

module.exports.home = async (req, res) => {
    const featured = await listingService.getFeaturedListings(8);
    res.render("./home.ejs", { featured, categoryMeta });
};

module.exports.renderNewForm = (req, res) => {
    res.render("./listings/new.ejs", {
        listing: null,
        categoryMeta,
        listingAmenities: listingService.LISTING_AMENITIES
    });
}

module.exports.showListing = async (req, res) => {
    let { id } = req.params;
    const [listing, availability] = await Promise.all([
        listingService.getListingById(id),
        bookingService.getAvailability(id)
    ]);
    res.render("./listings/show.ejs", { listing, availability });
}

module.exports.createListing = async (req, res) => {
    await listingService.createListing(req.body.listing, req.user._id, req.file);
    req.flash("success", "NEW LISTING CREATED");
    res.redirect("/listings");
}

module.exports.renderEditForm = async (req, res) => {
    let { id } = req.params;
    let listing = await listingService.getListingById(id);
    res.render("./listings/edit.ejs", {
        listing,
        categoryMeta,
        listingAmenities: listingService.LISTING_AMENITIES
    });
}

module.exports.updateListing = async (req, res) => {
    let { id } = req.params;
    await listingService.updateListing(id, req.body.listing, req.file);
    req.flash("success", "Listing updated");
    res.redirect(`/listings/${id}`);
}

module.exports.destroyListing = async (req, res) => {
    let { id } = req.params;
    await listingService.deleteListing(id);
    req.flash("success", "Listing deleted");
    res.redirect("/listings");
}

module.exports.renderAvailabilityForm = async (req, res) => {
    let { id } = req.params;
    const [listing, availability] = await Promise.all([
        listingService.getListingById(id),
        bookingService.getAvailability(id)
    ]);
    res.render("./listings/availability.ejs", {
        listing,
        blocked: listing.blockedDates || [],
        roomsAvailability: availability.rooms || []
    });
}

module.exports.addBlockedDates = async (req, res) => {
    let { id } = req.params;
    const { start, end } = req.body;
    const dates = [];
    const formatLocalDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    };
    if (start) {
        const from = new Date(start + "T00:00:00");
        const to = end ? new Date(end + "T00:00:00") : from;
        if (to < from) {
            req.flash("error", "End date must be after start date.");
            return res.redirect(`/listings/${id}/availability`);
        }
        if ((to - from) / 86400000 > 62) {
            req.flash("error", "You can block up to 62 nights at once.");
            return res.redirect(`/listings/${id}/availability`);
        }
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            dates.push(formatLocalDate(d));
        }
    }
    if (dates.length === 0) {
        req.flash("error", "Please select at least one date to block.");
        return res.redirect(`/listings/${id}/availability`);
    }
    await listingService.addBlockedDates(id, dates);
    req.flash("success", `${dates.length} day(s) blocked.`);
    res.redirect(`/listings/${id}/availability`);
}

module.exports.removeBlockedDate = async (req, res) => {
    let { id } = req.params;
    let { date } = req.params;
    await listingService.removeBlockedDate(id, date);
    req.flash("success", "Blocked date removed.");
    res.redirect(`/listings/${id}/availability`);
}