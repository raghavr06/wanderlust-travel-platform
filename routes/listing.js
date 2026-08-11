const express=require("express");
const router=express.Router();
const Listing=require("../models/listing");
const wrapAsync=require("../utils/wrapAsync.js");
/* const ExpressError=require("../utils/ExpressError.js");
const {listingSchema}=require("../schema.js"); */
const { isLoggedIn,isOwner, validateListing } = require("../middleware.js");
const listingController=require("../controllers/listings.js");
const multer  = require('multer');
const { storage } = require("../cloudinary.js");

const upload = multer({storage});

router.route("/")
      .get(wrapAsync(listingController.index)) //Index Route
      .post(isLoggedIn,upload.single("image"),validateListing,wrapAsync(listingController.createListing)); //Create Route
    
//New Route
router.get("/new",isLoggedIn,listingController.renderNewForm);

router.route("/:id")
        .get(wrapAsync(listingController.showListing)) // Show Route
        .patch(isLoggedIn,isOwner,upload.single("image"),validateListing,wrapAsync(listingController.updateListing)) //Update Route
        .delete(isLoggedIn,isOwner,wrapAsync(listingController.destroyListing)); //DELETE ROUTE

//Edit Route
router.get("/:id/edit",isLoggedIn,wrapAsync(listingController.renderEditForm));

module.exports=router;