require("dotenv").config();
const mongoose = require("mongoose");
const listingRepository = require("../src/modules/listings/listing.repository");
const userRepository = require("../src/modules/users/user.repository");
const env = require("../src/config/env");

// ─────────────────────────────────────────────────────────────────────────────
// Known working Nuitee hotel IDs across major cities (confirmed on sandbox)
// ─────────────────────────────────────────────────────────────────────────────
const HOTEL_IDS = [
    // New York
    "lp1897", "lp3386", "lp19969", "lp14840", "lp23523",
    // Los Angeles
    "lp4019", "lp2553", "lp6984", "lp5148", "lp9821",
    // Paris
    "lp44536", "lp30221", "lp41072",
    // London
    "lp57198", "lp60701", "lp46041",
    // Dubai
    "lp32985", "lp35285", "lp33712",
    // Tokyo
    "lp77412", "lp71245",
    // Barcelona
    "lp22588", "lp21438",
    // Rome
    "lp17041", "lp18931",
    // Amsterdam
    "lp51221", "lp53174",
    // Sydney
    "lp88901", "lp85321",
];

const CHUNK_SIZE = 10;

async function fetchHotelBatch(ids, apiKey) {
    const url = `https://api.liteapi.travel/v3.0/data/hotels?hotelIds=${ids.join(",")}`;
    const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
    if (!res.ok) {
        console.warn(`  [Nuitee] Batch failed ${res.status}:`, await res.text());
        return [];
    }
    const json = await res.json();
    return json.data || json.hotels || [];
}

function detectCategory(h) {
    const name = (h.name || "").toLowerCase();
    const desc = (h.description || "").toLowerCase();
    if (name.includes("beach") || desc.includes("beach")) return "Beach";
    if (name.includes("mountain") || desc.includes("ski") || desc.includes("alpine")) return "Mountain";
    if (name.includes("resort") || desc.includes("resort")) return "Trending";
    return "Rooms";
}

function hotelToListing(h, hostId) {
    const hotelId = String(h.id || h.hotelId || "");
    const title = h.name || "Luxury Hotel";
    const description =
        h.description ||
        h.overview ||
        `Experience world-class hospitality at ${title}. Premium amenities, exceptional service, and unforgettable memories.`;
    const city   = h.cityName   || h.city    || "New York";
    const country = h.countryName || h.country || "United States";
    const basePrice = h.minRate || h.price || (Math.floor(Math.random() * 250) + 80);

    let imageUrl = "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800";
    if (h.images && h.images.length > 0) {
        imageUrl = h.images[0].url || h.images[0] || imageUrl;
    }

    return {
        title,
        description,
        location: `${city}, ${country}`,
        country,
        price: Math.round(basePrice),
        category: detectCategory(h),
        maxGuests: 4,
        nuiteeHotelId: hotelId,
        image: { filename: `nuitee_${hotelId}`, url: imageUrl },
        owner: hostId,
        rooms: [
            { name: "Standard Room",   maxGuests: 2, price: Math.round(basePrice) },
            { name: "Deluxe Room",     maxGuests: 2, price: Math.round(basePrice * 1.25) },
            { name: "Executive Suite", maxGuests: 4, price: Math.round(basePrice * 1.75) }
        ]
    };
}

async function syncNuiteeHotels() {
    const apiKey = env.nuitee.apiKey;
    if (!apiKey) {
        console.error("❌ NUITEE_API_KEY is missing in .env!");
        process.exit(1);
    }

    console.log("🔄 Connecting to MongoDB...");
    await mongoose.connect(env.mongoUrl);
    console.log("✅ Connected to MongoDB.");

    // Ensure demo host user exists
    let host = await userRepository.findByUsername("demo-host");
    if (!host) {
        const User = require("../src/modules/users/user.model");
        host = await User.register(
            new User({ username: "demo-host", email: "host@wanderlust.dev" }),
            "booklub123"
        );
        console.log("👤 Created demo-host user.");
    }

    const uniqueIds = [...new Set(HOTEL_IDS)];
    console.log(`\n🌐 Fetching ${uniqueIds.length} hotels via hotelIds endpoint (batches of ${CHUNK_SIZE})...`);

    const allHotels = [];
    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
        const batch = uniqueIds.slice(i, i + CHUNK_SIZE);
        process.stdout.write(`  → Batch ${Math.floor(i / CHUNK_SIZE) + 1}: [${batch.join(", ")}] ... `);
        const hotels = await fetchHotelBatch(batch, apiKey);
        console.log(`got ${hotels.length} hotels`);
        allHotels.push(...hotels);
        if (i + CHUNK_SIZE < uniqueIds.length) await new Promise(r => setTimeout(r, 300));
    }

    if (allHotels.length === 0) {
        console.warn("\n⚠️ No hotels returned. Exiting.");
        await mongoose.disconnect();
        process.exit(0);
    }

    const Listing = require("../src/modules/listings/listing.model");
    console.log(`\n📦 Importing ${allHotels.length} hotels into Wanderlust...`);
    let imported = 0, skipped = 0;

    for (const h of allHotels) {
        const hotelId = String(h.id || h.hotelId || "");
        if (!hotelId) { skipped++; continue; }

        const existing = await Listing.findOne({ nuiteeHotelId: hotelId }).lean();
        if (existing) {
            console.log(`  ↩  Skipping "${h.name}" — already exists`);
            skipped++;
            continue;
        }

        const data = hotelToListing(h, host._id);
        await listingRepository.create(data);
        console.log(`  ✅ ${data.title} — ${data.location} ($${data.price}/night)`);
        imported++;
    }

    console.log(`\n🎉 Sync complete! Imported: ${imported} | Skipped (duplicates): ${skipped}`);
    await mongoose.disconnect();
}

syncNuiteeHotels()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Sync Error:", err.message);
        process.exit(1);
    });




