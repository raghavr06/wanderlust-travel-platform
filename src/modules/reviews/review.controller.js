const reviewService = require("./review.service.js");

module.exports.createReview = async (req, res) => {
    let { id } = req.params;
    try {
        await reviewService.createReview(id, req.body.review, req.user._id);
        req.flash("success", "Review added. Thank you!");
    } catch (err) {
        const message = err.statusCode && err.statusCode < 500 ? err.message : "Something went wrong.";
        req.flash("error", message);
    }
    res.redirect(`/listings/${id}`);
}

module.exports.destroyReview = async (req, res) => {
    let { id, reviewId } = req.params;
    try {
        await reviewService.deleteReview(id, reviewId);
        req.flash("success", "Review deleted");
    } catch (err) {
        req.flash("error", "Something went wrong.");
    }
    res.redirect(`/listings/${id}`);
}