const express=require("express");
const app=express();
const session=require("express-session");
const flash=require("connect-flash");

const sessionOptions=({secret:"mysecretsuperstring", resave:false , saveUninitialized:false});
app.use(session(sessionOptions));

app.get("/requestcount",(req,res)=>{
    if(req.session.count){
        req.session.count+=1;
    }else{
        req.session.count=1;
    }
    res.send(`You sent request ${req.session.count} times`);
})

app.listen(3000,()=>{
    console.log("server listening on port 3000");
})