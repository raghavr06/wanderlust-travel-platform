const express = require("express");
const app = express();
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const flash = require("connect-flash");
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require("connect-redis");

const env = require("./config/env");
const configurePassport = require("./config/passport");
const { redisClient } = require("./infrastructure/redis/redis");

const listingRouter = require("./modules/listings/listing.routes.js");
const reviewRouter = require("./modules/reviews/review.routes.js");
const authRouter = require("./modules/auth/auth.routes.js");
const userRouter = require("./modules/users/user.routes.js");
const bookingRouter = require("./modules/bookings/booking.routes.js");
const notificationRouter = require("./modules/notifications/notification.routes.js");
const aiRouter = require("./modules/ai/ai.routes.js");

const listingController = require("./modules/listings/listing.controller.js");
const notificationService = require("./modules/notifications/notification.service.js");
const wrapAsync = require("./common/utils/wrapAsync.js");
const notFoundHandler = require("./common/middlewares/notFound.middleware.js");
const { errorHandler } = require("./common/middlewares/error.middleware.js");

// View Engine & Static Setup
app.set("view engine", "ejs");
app.engine("ejs", ejsMate);
app.use(express.static("public"));

// Body Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));

// Security Middlewares
app.use((req, res, next) => {
    const sanitizeOptions = { replaceWith: '_' };
    if (req.body) mongoSanitize.sanitize(req.body, sanitizeOptions);
    if (req.query) mongoSanitize.sanitize(req.query, sanitizeOptions);
    if (req.params) mongoSanitize.sanitize(req.params, sanitizeOptions);
    next();
});

const scriptSrcUrls = [
    "https://cdn.jsdelivr.net/",
    "https://cdnjs.cloudflare.com/",
];
const styleSrcUrls = [
    "https://cdn.jsdelivr.net/",
    "https://cdnjs.cloudflare.com/",
    "https://fonts.googleapis.com/",
];
const connectSrcUrls = [];
const fontSrcUrls = [
    "https://fonts.gstatic.com/",
    "https://cdnjs.cloudflare.com/"
];

app.use(
    helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: [],
            connectSrc: ["'self'", ...connectSrcUrls],
            scriptSrc: ["'unsafe-inline'", "'self'", ...scriptSrcUrls],
            styleSrc: ["'self'", "'unsafe-inline'", ...styleSrcUrls],
            workerSrc: ["'self'", "blob:"],
            objectSrc: [],
            imgSrc: [
                "'self'",
                "blob:",
                "data:",
                "https://res.cloudinary.com/",
                "https://images.unsplash.com/",
            ],
            fontSrc: ["'self'", ...fontSrcUrls],
        },
    })
);

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use(limiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts from this IP, please try again after 15 minutes'
});
app.use('/login', authLimiter);
app.use('/signup', authLimiter);

// Session Store
const sessionOptions = {
    store: new RedisStore({ client: redisClient }),
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true
    }
};
app.use(session(sessionOptions));
app.use(flash());

// Passport Config
configurePassport(app);

// Locals Middleware
app.use((req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.currUser = req.user || null;
    next();
});

app.use(async (req, res, next) => {
    try {
        res.locals.unreadCount = req.user ? await notificationService.unreadCount(req.user._id) : 0;
    } catch (err) {
        res.locals.unreadCount = 0;
    }
    next();
});

// Route Registrations
app.get("/", wrapAsync(listingController.home));
app.use("/listings", listingRouter);
app.use("/listings/:id/reviews", reviewRouter);
app.use("/listings/:listingId/bookings", bookingRouter);
app.use("/notifications", notificationRouter);
app.use("/ai", aiRouter);
app.use("/users", userRouter);
app.use("/", authRouter);

app.get("/terms", (req, res) => { res.render("static/terms.ejs"); });
app.get("/privacy", (req, res) => { res.render("static/privacy.ejs"); });

// 404 Catch-All
app.use(notFoundHandler);

// Centralized Error Handling
app.use(errorHandler);

module.exports = app;
