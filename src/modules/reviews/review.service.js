const reviewRepository = require("./review.repository.js");
const listingRepository = require("../listings/listing.repository.js");
const cacheService = require("../../common/services/cache.service.js");
const AppError = require("../../common/utils/AppError.js");

class ReviewService {
    async createReview(listingId, reviewData, authorId) {
        const listing = await listingRepository.findById(listingId);
        if (!listing) {
            throw new AppError(404, "Listing not found");
        }
        if (listing.owner && String(listing.owner) === String(authorId)) {
            throw new AppError(400, "You cannot review your own listing");
        }

        const alreadyReviewed = await reviewRepository.existsForListing(listing.reviews, authorId);
        if (alreadyReviewed) {
            throw new AppError(400, "You have already reviewed this listing");
        }

        const newReview = await reviewRepository.createReviewDoc(reviewData, authorId);

        listing.reviews.push(newReview);
        await listing.save();

        await cacheService.clearPattern("listings:*");
        return newReview;
    }

    async deleteReview(listingId, reviewId) {
        await reviewRepository.removeReviewFromListing(listingId, reviewId);
        await reviewRepository.deleteById(reviewId);

        await cacheService.clearPattern("listings:*");
    }
}

module.exports = new ReviewService();