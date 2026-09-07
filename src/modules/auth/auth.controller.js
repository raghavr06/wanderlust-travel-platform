const authService = require("./auth.service.js");
const bookingService = require("../bookings/booking.service.js");
const listingService = require("../listings/listing.service.js");

module.exports.renderSignupForm = (req, res) => {
    res.render("users/signup.ejs");
}

module.exports.signUp = async (req, res, next) => {
    try {
        const registeredUser = await authService.registerUser(req.body, req.body.password);
        req.login(registeredUser, (err) => {
            if (err) {
                return next(err);
            }
            req.flash("success", "Welcome to Wanderlust! You are logged in");
            res.redirect("/listings");
        });
    } catch (err) {
        req.flash("error", err.message);
        res.redirect("/signup");
    }
}

module.exports.renderLoginForm = (req, res) => {
    res.render("users/login.ejs");
}

module.exports.login = async (req, res) => {
    req.flash("success", "Welcome to Wanderlust! You are logged in");
    let redirectUrl = res.locals.redirectUrl || "/listings";
    res.redirect(redirectUrl);
}

module.exports.logout = (req, res, next) => {
    req.logOut((err) => {
        if (err) {
            return next(err);
        }
        req.flash("success", "Logged out");
        res.redirect("/listings");
    })
}

module.exports.renderProfile = async (req, res) => {
    const [bookings] = await Promise.all([
        bookingService.getBookingsByGuest(req.user._id)
    ]);
    res.render("users/profile.ejs", { bookings });
}

module.exports.renderDashboard = async (req, res) => {
    const [hostData, myListings] = await Promise.all([
        bookingService.getBookingRequestsByHost(req.user._id),
        listingService.getListingsByOwner(req.user._id)
    ]);

    const requests = hostData.requests || [];
    const stats = {
        total: requests.length,
        confirmed: requests.filter(b => b.status === "CONFIRMED").length,
        cancelled: requests.filter(b => b.status === "CANCELLED").length,
        revenue: requests
            .filter(b => ["CONFIRMED", "COMPLETED"].includes(b.status))
            .reduce((sum, b) => sum + (b.totalPrice || 0), 0)
    };

    res.render("users/dashboard.ejs", { requests, myListings, stats });
}

module.exports.cancelBooking = async (req, res) => {
    let { bookingId } = req.params;
    try {
        await bookingService.updateBookingStatus(bookingId, "CANCELLED", req.user._id);
        req.flash("success", "Booking cancelled.");
    } catch (err) {
        const message = err.statusCode && err.statusCode < 500 ? err.message : "Something went wrong.";
        req.flash("error", message);
    }
    res.redirect("/profile");
}