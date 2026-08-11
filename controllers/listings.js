const Listing=require("../models/listing");

module.exports.index=async(req,res)=>{
    let allListings=await Listing.find();
    res.render("./listings/index.ejs",{allListings});
}

module.exports.renderNewForm=(req,res)=>{
     res.render("./listings/new.ejs");
}

module.exports.showListing=async(req,res)=>{
    let {id}=req.params;
    const listing=await Listing.findById(id).populate({path:"reviews",populate:{path:"author"}}).populate("owner");
    res.render("./listings/show.ejs",{listing});
}

module.exports.createListing=async(req,res)=>{
    let url=req.file.path;
    let filename=req.file.filename;

    let newListing=new Listing(req.body.listing);
    newListing.owner=req.user._id;

    if(req.file){
        newListing.image={
            url:req.file.path,
            filename:req.file.filename
        }
    }
    
    await newListing.save();
    req.flash("success","NEW LISTING CREATED");
    res.redirect("/listings");
}

module.exports.renderEditForm=async(req,res)=>{
    let {id}=req.params;
    let listing=await Listing.findById(id);
    res.render("./listings/edit.ejs",{listing});
}

module.exports.updateListing=async (req,res)=>{
    let {id}=req.params;
    let listing= await Listing.findById(id);
    listing.set(req.body.listing);

    if(req.file){
        listing.image={
            url:req.file.path,
            filename:req.file.filename
        }  
    }
    await listing.save();
    req.flash("success","Listing updated");
    res.redirect(`/listings/${id}`);
}

module.exports.destroyListing=async(req,res)=>{
    let {id}=req.params;
    await Listing.findByIdAndDelete(id);
    req.flash("success","Listing deleted");
    res.redirect("/listings");
}