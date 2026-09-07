const Listing = require("../../modules/listings/listing.model.js");
const Review = require("../../modules/reviews/review.model.js");
const AppError = require("../utils/AppError.js");
const { listingSchema } = require("../../modules/listings/listing.validation.js");
const { reviewSchema } = require("../../modules/reviews/review.validation.js");

function safeEquals(a, b) {
    return a && b && typeof a.equals === "function" ? a.equals(b) : false;
}

module.exports.isLoggedIn=(req,res,next)=>{
    if(!req.isAuthenticated()){
        req.session.redirectUrl=req.originalUrl;
        req.flash("error","You must be logged in");
        return res.redirect("/login");
    }
    next();
}

module.exports.saveRedirectUrl=(req,res,next)=>{
    if(req.session.redirectUrl){
        res.locals.redirectUrl=req.session.redirectUrl;
    }
    next();
}

module.exports.isOwner=async(req,res,next)=>{
    let {id}=req.params;
    let listing=await Listing.findById(id);
    if(!listing){
        return next(new AppError(404,"Listing not found"));
    }
    if(!safeEquals(listing.owner, res.locals.currUser?._id)){
        req.flash("error","You are not the owner of the listing");
        return res.redirect(`/listings/${id}`);
    }
    next();
}

module.exports.isReviewAuthor=async(req,res,next)=>{
    let {id,reviewId}=req.params;
    let review=await Review.findById(reviewId);
    if(!review){
        return next(new AppError(404,"Review not found"));
    }
    if(!safeEquals(review.author, res.locals.currUser?._id)){
        req.flash("error","You are not the author of the review");
        return res.redirect(`/listings/${id}`);
    }
    next();
}

module.exports.validateListing=(req,res,next)=>{
    let {error}=listingSchema.validate(req.body,{abortEarly:false});
    if(error){
        const message=error.details.map((d)=>d.message.replace(/"/g,"'")).join(", ");
        return next(new AppError(400,message));
    }
    next();
}

module.exports.validateReview=(req,res,next)=>{
    let {error}=reviewSchema.validate(req.body,{abortEarly:false});
    if(error){
        const message=error.details.map((d)=>d.message.replace(/"/g,"'")).join(", ");
        return next(new AppError(400,message));
    }
    next();
}