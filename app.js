require('dotenv').config()


const express=require("express");
const app=express();
const mongoose=require("mongoose");
/* const Listing=require("./models/listing"); */  // commented lines not required after creating router
const methodOverride=require("method-override");
const ejsMate=require("ejs-mate");
const session=require("express-session");
const flash=require("connect-flash");

const passport=require("passport");
const LocalStrategy=require("passport-local");
const User=require("./src/modules/users/user.model.js");
/* const wrapAsync=require("./utils/wrapAsync.js");
const ExpressError=require("./utils/ExpressError.js");
const {listingSchema}=require("./schema.js");
const {reviewSchema}=require("./schema.js");
const Review=require("./models/review.js"); */

const listingRouter=require("./src/modules/listings/listing.routes.js");
const reviewRouter=require("./src/modules/reviews/review.routes.js");
const userRouter=require("./src/modules/auth/auth.routes.js");
const bookingRouter=require("./src/modules/bookings/booking.routes.js");
const notificationRouter=require("./src/modules/notifications/notification.routes.js");
const listingController=require("./src/modules/listings/listing.controller.js");
const wrapAsync=require("./src/common/utils/wrapAsync.js");

const MONGO_URL= process.env.MONGO_URL || "mongodb://127.0.0.1:27017/wanderlust";

if (process.env.NODE_ENV !== 'test') {
    main().then(()=>{console.log("connected to db")}).catch((err)=>{console.log(err)});
}

async function main(){
    await mongoose.connect(MONGO_URL);
}
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const AppError = require('./src/common/utils/AppError.js');

app.set("view engine","ejs");
app.use(express.urlencoded({extended:true}));
app.use(methodOverride("_method"));
app.engine("ejs",ejsMate);
app.use(express.static("public"));
app.use(express.json());

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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window`
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use(limiter);

// Specific Auth Limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts from this IP, please try again after 15 minutes'
});
app.use('/login', authLimiter);
app.use('/signup', authLimiter);

const { RedisStore } = require("connect-redis");
const redis = require("redis");
const redisClient = redis.createClient({ url: process.env.REDIS_URL || "redis://127.0.0.1:6379" });
redisClient.on("error", (err) => console.error("Redis Client Error", err));
if (process.env.NODE_ENV !== 'test') {
    redisClient.connect();
}

const sessionOptions={
    store: new RedisStore({ client: redisClient }),
    secret:process.env.SESSION_SECRET || "local-dev-only-session-secret",
    resave:false,
    saveUninitialized:true,
    cookie:{
        maxAge:7*24*60*60*1000,
        httpOnly:true
    }
};

app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req,res,next)=>{
    res.locals.success=req.flash("success");
    res.locals.error=req.flash("error");
    res.locals.currUser=req.user || null;
    next();
})

const notificationService=require("./src/modules/notifications/notification.service.js");
app.use(async (req,res,next)=>{
    try {
        res.locals.unreadCount = req.user ? await notificationService.unreadCount(req.user._id) : 0;
    } catch (err) {
        res.locals.unreadCount = 0;
    }
    next();
})

// Home page
app.get("/", wrapAsync(listingController.home));

app.use("/listings",listingRouter);
app.use("/listings/:id/reviews",reviewRouter);
app.use("/listings/:listingId/bookings",bookingRouter);
app.use("/notifications",notificationRouter);
app.use("/",userRouter);

app.get("/terms", (req,res)=>{ res.render("static/terms.ejs"); });
app.get("/privacy", (req,res)=>{ res.render("static/privacy.ejs"); });

// 404 catch-all - MUST be after all routers
app.use((req, res, next) => {
    next(new AppError(404, "Page Not Found!"));
});

//Error Handling Middleware
app.use((err,req,res,next)=>{
    console.error(err);
    if(res.headersSent){
        return next(err);
    }
    let {statusCode=500,message="something went wrong"}=err;
    res.status(statusCode).render("error.ejs",{message});
});

/* app.get("/demouser",async(req,res)=>{
    let fakeUser=new User({
        email:"student@gmail.com",
        username:"delta-student"
    });

    let info=await User.register(fakeUser,"hellow");
    res.send(info);
}) */

if (process.env.NODE_ENV !== 'test') {
    app.listen(8080,()=>{
        console.log("server listening on port 8080");
    })
}

module.exports = app;