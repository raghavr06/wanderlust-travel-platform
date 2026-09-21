const mongoose=require("mongoose");
const Schema=mongoose.Schema;
const Review=require("../reviews/review.model.js");

const LISTING_CATEGORIES = [
    "Rooms",
    "Iconic Cities",
    "Mountains",
    "Castles",
    "Amazing Pools",
    "Camping",
    "Farms",
    "Arctic",
    "Domes",
    "Boats"
];

const LISTING_AMENITIES = [
    "Wifi",
    "Kitchen",
    "Free parking",
    "Air conditioning",
    "Heating",
    "Washer",
    "Pool",
    "Gym",
    "Pets allowed",
    "Self check-in"
];

const roomSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    maxGuests: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    price: {
        type: Number,
        min: 0,
        default: null
    }
}, { _id: true });

const listingSchema=new Schema({
    title:String,
    description:String,
    image:{
        filename:String,
        url:String
    },
    price:{
        type:Number,
        required:true,
        min:0
    },
    location:String,
    country:String,
    category: {
        type: String,
        enum: LISTING_CATEGORIES,
        default: "Rooms"
    },
    amenities: [{
        type: String,
        enum: LISTING_AMENITIES
    }],
    maxGuests: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    rooms: [roomSchema],
    blockedDates: [{
        type: Date
    }],
    lockVersion: {
        type: Number,
        default: 0
    },
    nuiteeHotelId: {
        type: String,
        default: null
    },
    reviews:[{
        type:Schema.Types.ObjectId,
        ref:"Review"
    }],
    owner:{
        type:Schema.Types.ObjectId,
        ref:"User"
    }
}, { timestamps: true });

listingSchema.index({ category: 1 });
listingSchema.index({ country: 1 });
listingSchema.index({ price: 1 });
listingSchema.index({ nuiteeHotelId: 1 });

listingSchema.post("findOneAndDelete",async(listing)=>{
    if(listing){
        await Review.deleteMany({_id:{$in:listing.reviews}});
    }
})

const Listing=mongoose.model("Listing",listingSchema);
module.exports=Listing;
module.exports.LISTING_CATEGORIES=LISTING_CATEGORIES;
module.exports.LISTING_AMENITIES=LISTING_AMENITIES;