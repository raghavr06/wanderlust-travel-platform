const express=require("express");
const router=express.Router({mergeParams:true});
const wrapAsync=require("../utils/wrapAsync.js");
/* const ExpressError=require("../utils/ExpressError.js"); */
const Listing=require("../models/listing");
const Review=require("../models/review.js");
/* const {reviewSchema}=require("../schema.js"); */
const {validateReview,isLoggedIn,isReviewAuthor}=require("../middleware.js");
const reviewController=require("../controllers/reviews.js");


// Reviews- Post Route
router.post("/",isLoggedIn,validateReview,wrapAsync(reviewController.createReview));

//Review-Delete Route
router.delete("/:reviewId",isLoggedIn,isReviewAuthor,wrapAsync(reviewController.destroyReview));

module.exports=router;