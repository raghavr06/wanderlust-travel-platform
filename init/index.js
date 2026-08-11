const mongoose=require("mongoose");
const initData=require("./data.js");
const Listing=require("../models/listing.js");

const MONGO_URL="mongodb://127.0.0.1:27017/wanderlust";

main().then(()=>{console.log("connected to db")}) . catch((err)=>{console.log(err)});

async function main(){
    await mongoose.connect(MONGO_URL);
}

const init=async()=>{
    await Listing.deleteMany({});
    initData.data=initData.data.map((obj)=>({
        ...obj,owner:'68ef0ccaa25c0aa8bc3a3358'
    }));
    await Listing.insertMany(initData.data);
    
    console.log("data initialized");
}

init();