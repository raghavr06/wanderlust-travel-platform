const Review = require("./review.model.js");
const Listing = require("../listings/listing.model.js");
const cacheService = require("../../common/services/cache.service.js");
const AppError = require("../../common/utils/AppError.js");

class ReviewService {
    async createReview(listingId, reviewData, authorId) {
        const listing = await Listing.findById(listingId);
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }
        if (listing.owner && String(listing.owner) === String(authorId)) {
            throw new AppError(400, "You cannot review your own listing");
        }

        const alreadyReviewed = await Review.exists({
            _id: { $in: listing.reviews },
            author: authorId
        });
        if (alreadyReviewed) {
            throw new AppError(400, "You have already reviewed this listing");
        }

        const newReview = new Review(reviewData);
        newReview.author = authorId;

        listing.reviews.push(newReview);
        await newReview.save();
        await listing.save();

        await cacheService.clearPattern("listings:*");
        return newReview;
    }

    async deleteReview(listingId, reviewId) {
        await Listing.findByIdAndUpdate(listingId, { $pull: { reviews: reviewId } });
        await Review.findByIdAndDelete(reviewId);

        await cacheService.clearPattern("listings:*");
    }
}

module.exports = new ReviewService();