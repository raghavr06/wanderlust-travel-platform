const express = require("express");
const router = express.Router();
const wrapAsync = require("../../common/utils/wrapAsync.js");
const { isLoggedIn, isOwner, validateListing } = require("../../common/middlewares/auth.middleware.js");
const listingController = require("./listing.controller.js");
const { upload } = require("../../infrastructure/cloudinary/cloudinary.js");

router.route("/")
      .get(wrapAsync(listingController.index))
      .post(isLoggedIn, upload.single("image"), validateListing, wrapAsync(listingController.createListing));

//New Route
router.get("/new", isLoggedIn, listingController.renderNewForm);

// Availability management (owner only)
router.get("/:id/availability", isLoggedIn, isOwner, wrapAsync(listingController.renderAvailabilityForm));
router.post("/:id/availability", isLoggedIn, isOwner, wrapAsync(listingController.addBlockedDates));
router.delete("/:id/availability/:date", isLoggedIn, isOwner, wrapAsync(listingController.removeBlockedDate));

router.route("/:id")
        .get(wrapAsync(listingController.showListing))
        .patch(isLoggedIn, isOwner, upload.single("image"), validateListing, wrapAsync(listingController.updateListing))
        .delete(isLoggedIn, isOwner, wrapAsync(listingController.destroyListing));

//Edit Route
router.get("/:id/edit", isLoggedIn, isOwner, wrapAsync(listingController.renderEditForm));

module.exports = router;