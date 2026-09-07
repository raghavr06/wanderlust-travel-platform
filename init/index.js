require("dotenv").config();
const mongoose = require("mongoose");
const initData = require("./data.js");
const Listing = require("../src/modules/listings/listing.model.js");
const User = require("../src/modules/users/user.model.js");
const { LISTING_AMENITIES } = require("../src/modules/listings/listing.model.js");

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/wanderlust";

const CATEGORY_CYCLE = ["Rooms", "Iconic Cities", "Mountains", "Castles", "Amazing Pools", "Camping", "Farms", "Arctic", "Domes", "Boats"];

const ROOM_NAMES = {
    "Rooms": ["Standard Room", "Deluxe Room", "Executive Suite"],
    "Iconic Cities": ["City View Room", "Penthouse", "Loft Studio"],
    "Mountains": ["Mountain View Cabin", "Rustic Cottage", "Chalet Suite"],
    "Castles": ["Knight's Chamber", "Queen's Suite", "Tower Room"],
    "Amazing Pools": ["Poolside Room", "Luxury Villa"],
    "Camping": ["Tent Site", "Glamping Tent", "Campsite Cabin"],
    "Farms": ["Farm Cottage", "Homestead Room"],
    "Arctic": ["Igloo", "Glass Dome Cabin"],
    "Domes": ["Standard Dome", "Deluxe Dome", "Glamping Pod"],
    "Boats": ["Sailboat Cabin", "Houseboat Suite", "Deck Room"]
};

const ROOM_PRICE_MULTIPLIERS = [1, 1.3, 1.6];
const ROOM_CAPACITY = [2, 3, 4];

const pickAmenities = (i) => {
    const chunk = [];
    for (let k = 0; k < Math.min(4, LISTING_AMENITIES.length); k++) {
        chunk.push(LISTING_AMENITIES[(i + k) % LISTING_AMENITIES.length]);
    }
    return chunk;
};

const buildRooms = (category, basePrice) => {
    const names = ROOM_NAMES[category] || ROOM_NAMES["Rooms"];
    // 2-3 rooms per listing
    const count = 2 + (basePrice % 2);
    return names.slice(0, count).map((name, k) => ({
        name,
        maxGuests: ROOM_CAPACITY[k],
        price: Math.round(basePrice * ROOM_PRICE_MULTIPLIERS[k])
    }));
};

const init = async () => {
    await mongoose.connect(MONGO_URL);
    console.log("connected to db");

    // Demo users
    let host = await User.findByUsername("demo-host");
    if (!host) {
        host = await User.register(
            new User({ username: "demo-host", email: "host@wanderlust.dev" }),
            "booklub123"
        );
    }
    if (!(await User.findByUsername("demo-guest"))) {
        await User.register(
            new User({ username: "demo-guest", email: "guest@wanderlust.dev" }),
            "booklub123"
        );
    }

    await Listing.deleteMany({});

    const data = initData.data.map((obj, i) => {
        const category = CATEGORY_CYCLE[i % CATEGORY_CYCLE.length];
        const rooms = buildRooms(category, obj.price);
        return {
            ...obj,
            owner: host._id,
            category,
            maxGuests: rooms.reduce((sum, r) => sum + r.maxGuests, 0),
            price: Math.min(obj.price, ...rooms.map(r => r.price)),
            amenities: pickAmenities(i),
            rooms
        };
    });

    await Listing.insertMany(data);

    console.log(`data initialized (${data.length} listings)`);
    await mongoose.disconnect();
};

init().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
});