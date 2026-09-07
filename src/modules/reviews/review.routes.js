const express=require("express");
const router=express.Router({mergeParams:true});
const wrapAsync = require("../../common/utils/wrapAsync.js");
/* const AppError=require("../../common/utils/AppError.js"); */
const Listing = require("../listings/listing.model.js");
const Review = require("./review.model.js");
/* const {reviewSchema}=require("./review.validation.js"); */
const { validateReview, isLoggedIn, isReviewAuthor } = require("../../common/middlewares/auth.middleware.js");
const reviewController = require("./review.controller.js");


// Reviews- Post Route
router.post("/",isLoggedIn,validateReview,wrapAsync(reviewController.createReview));

//Review-Delete Route
router.delete("/:reviewId",isLoggedIn,isReviewAuthor,wrapAsync(reviewController.destroyReview));

module.exports=router;