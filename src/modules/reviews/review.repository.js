const Review = require("./review.model.js");
const Listing = require("../listings/listing.model.js");

class ReviewRepository {
    async findById(id) {
        return Review.findById(id);
    }

    async existsForListing(reviewIds, authorId) {
        return Review.exists({
            _id: { $in: reviewIds },
            author: authorId
        });
    }

    async createReviewDoc(reviewData, authorId) {
        const newReview = new Review(reviewData);
        newReview.author = authorId;
        return newReview.save();
    }

    async addReviewToListing(listingId, reviewObj) {
        return Listing.findByIdAndUpdate(listingId, { $push: { reviews: reviewObj } });
    }

    async removeReviewFromListing(listingId, reviewId) {
        return Listing.findByIdAndUpdate(listingId, { $pull: { reviews: reviewId } });
    }

    async deleteById(reviewId) {
        return Review.findByIdAndDelete(reviewId);
    }
}

module.exports = new ReviewRepository();
