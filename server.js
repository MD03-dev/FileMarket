require("dotenv").config();
const express=require("express");
const session=require("express-session");
const bcrypt=require("bcryptjs");
const multer=require("multer");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const app=express();

const ROOT=__dirname;
const STORAGE=path.join(ROOT,"storage");
const PRODUCTS=path.join(STORAGE,"products");
const IMAGES=path.join(STORAGE,"images");
const VIDEOS=path.join(STORAGE,"videos");
const DB=path.join(STORAGE,"data.json");
const PORT=process.env.PORT||3000;

for(const d of [STORAGE,PRODUCTS,IMAGES,VIDEOS]){
 fs.mkdirSync(d,{recursive:true});
}

function id(){
 return crypto.randomUUID();
}

function now(){
 return new Date().toISOString();
}

function save(){
 const tmp=DB+".tmp";
 fs.writeFileSync(tmp,JSON.stringify(data,null,2),"utf8");
 fs.renameSync(tmp,DB);
}

let data;

if(fs.existsSync(DB)){
 try{
  data=JSON.parse(fs.readFileSync(DB,"utf8"));
 }catch{
  data=null;
 }
}

if(!data){
 data={
  users:[],
  products:[],
  orders:[],
  reviews:[],
  favorites:[],
  carts:[],
  messages:[],
  notifications:[],
  walletTransactions:[],
  topups:[],
  withdrawals:[],
  vouchers:[],
  settings:{
   siteName:"FileMarket",
   commission:10,
   cardOtherDiscountPercent:10,
   withdrawFeePercent:10,
   coinToVnd:1,
   maxWithdrawals7d:2,
     bankName:"YOUR BANK",
   bankAccount:"YOUR ACCOUNT",
   bankOwner:"YOUR NAME",
   paymentNote:"Ghi mã đơn hàng khi chuyển khoản."
  },
  adminPasswordHash:bcrypt.hashSync("Admin@123456",12)
 };
 save();
}

function repairUsers(){
 let changed=false;

 for(const u of data.users){
  if(typeof u.email==="string"){
   const e=u.email.trim().toLowerCase();

   if(u.email!==e){
    u.email=e;
    changed=true;
   }
  }

  if(u.coins===undefined){
   u.coins=0;
   changed=true;
  }

  if(u.banned===undefined){
   u.banned=false;
   changed=true;
  }

  if(u.verified===undefined){
   u.verified=false;
   changed=true;
  }
 }

 if(changed){
  save();
 }
}
function ensure(){
 data.users??=[];
 data.products??=[];
 data.orders??=[];
 data.reviews??=[];
 data.favorites??=[];
 data.carts??=[];
 data.messages??=[];
 data.notifications??=[];
 data.walletTransactions??=[];
 data.topups??=[];
 data.withdrawals??=[];
 data.vouchers??=[];
 data.settings??={};

 for(const u of data.users){
  if(!Number.isFinite(Number(u.coins))){
   u.coins=0;
  }
 }

 Object.assign(data.settings,{
  siteName:"FileMarket",
  commission:10,
  cardOtherDiscountPercent:10,
  withdrawFeePercent:10,
  coinToVnd:1,
  maxWithdrawals7d:2,
    bankName:"YOUR BANK",
  bankAccount:"YOUR ACCOUNT",
  bankOwner:"YOUR NAME",
  paymentNote:"Ghi mã giao dịch khi chuyển khoản.",
  bankAccounts:[],
  currency:"VND"
 },data.settings);

 if(!Array.isArray(data.settings.bankAccounts)){
  data.settings.bankAccounts=[];
 }

 if(!data.adminPasswordHash){
  data.adminPasswordHash=bcrypt.hashSync("Admin@123456",12);
 }

 save();
}

ensure();
repairUsers();

app.use(express.json({limit:"5mb"}));
app.use(express.urlencoded({extended:true,limit:"5mb"}));

app.set("trust proxy",1);

app.use(session({
 secret:process.env.SESSION_SECRET||"filemarket-local-secret-change-me-2026",
 resave:false,
 saveUninitialized:false,
 rolling:true,
 cookie:{
  httpOnly:true,
  sameSite:"lax",
  secure:"auto",
  maxAge:7*24*60*60*1000
 }
}));

app.use(express.static(path.join(ROOT,"public")));

function crc32Buffer(crc,buf){
 let c=(crc^0xffffffff)>>>0;
 for(let i=0;i<buf.length;i++) c=CRC32_TABLE[(c^buf[i])&0xff]^(c>>>8);
 return (c^0xffffffff)>>>0;
}
const CRC32_TABLE=(()=>{
 const t=new Uint32Array(256);
 for(let n=0;n<256;n++){
  let c=n;
  for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
  t[n]=c>>>0;
 }
 return t;
})();
function crc32File(file){
 const fd=fs.openSync(file,"r"),buf=Buffer.allocUnsafe(1024*1024);
 let pos=0,crc=0;
 try{
  for(;;){
   const n=fs.readSync(fd,buf,0,buf.length,pos);
   if(!n)break;
   crc=crc32Buffer(crc,buf.subarray(0,n));
   pos+=n;
  }
 }finally{fs.closeSync(fd);}
 return crc>>>0;
}
function u16(n){const b=Buffer.allocUnsafe(2);b.writeUInt16LE(n&0xffff);return b;}
function u32(n){const b=Buffer.allocUnsafe(4);b.writeUInt32LE(n>>>0);return b;}
function createZipFromFiles(entries,outPath){
 const fd=fs.openSync(outPath,"w");
 const central=[]; let offset=0;
 try{
  for(const entry of entries){
   const name=String(entry.name||"file").replace(/\\/g,"/").replace(/^\/+/, "").split("/").filter(x=>x&&x!=="."&&x!=="..").join("/");
   const nameBuf=Buffer.from(name,"utf8");
   if(nameBuf.length>65535)throw new Error("Tên file quá dài");
   const stat=fs.statSync(entry.path),size=stat.size;
   if(size>0xffffffff||offset>0xffffffff)throw new Error("ZIP vượt giới hạn 4 GB");
   const crc=crc32File(entry.path),localOffset=offset;
   const local=Buffer.concat([
    Buffer.from([0x50,0x4b,0x03,0x04]),u16(20),u16(0x800),u16(0),
    u16(0),u16(0),u32(crc),u32(size),u32(size),u16(nameBuf.length),u16(0),nameBuf
   ]);
   fs.writeSync(fd,local);offset+=local.length;
   const inFd=fs.openSync(entry.path,"r"),buf=Buffer.allocUnsafe(1024*1024);
   let pos=0;
   try{
    for(;;){
     const n=fs.readSync(inFd,buf,0,buf.length,pos);
     if(!n)break;
     fs.writeSync(fd,buf.subarray(0,n));pos+=n;offset+=n;
    }
   }finally{fs.closeSync(inFd);}
   central.push(Buffer.concat([
    Buffer.from([0x50,0x4b,0x01,0x02]),u16(20),u16(20),u16(0x800),u16(0),
    u16(0),u16(0),u32(crc),u32(size),u32(size),u16(nameBuf.length),u16(0),
    u16(0),u16(0),u16(0),u32(0),u32(localOffset),nameBuf
   ]));
  }
  const centralStart=offset;
  for(const c of central){fs.writeSync(fd,c);offset+=c.length;}
  fs.writeSync(fd,Buffer.concat([
   Buffer.from([0x50,0x4b,0x05,0x06]),u16(0),u16(0),
   u16(central.length),u16(central.length),u32(offset-centralStart),
   u32(centralStart),u16(0)
  ]));
 }finally{fs.closeSync(fd);}
}

const productUpload=multer({
 storage:multer.diskStorage({
  destination:(req,file,cb)=>{
   const isImage=/^image\//.test(file.mimetype);
   const isVideo=/^video\//.test(file.mimetype);
   cb(null,isImage?IMAGES:isVideo?VIDEOS:PRODUCTS);
  },
  filename:(req,file,cb)=>{
   cb(null,id()+path.extname(file.originalname));
  }
 }),
 limits:{fileSize:1024*1024*1024,files:111}
});

const productUploadMiddleware=(req,res,next)=>{
 productUpload.fields([
  {name:"file",maxCount:100},
  {name:"image",maxCount:10},
  {name:"video",maxCount:1}
 ])(req,res,err=>{
  if(err){
   for(const f of Object.values(req.files||{}).flat()){
    try{fs.unlinkSync(f.path);}catch{}
   }
   return next(err);
  }
  next();
 });
};

function user(req){
 return data.users.find(x=>x.id===req.session.userId);
}

function safeUser(u){
 if(!u)return null;

 return {
  id:u.id,
  name:u.name,
  email:u.email,
  role:u.role,
  sellerStatus:u.sellerStatus,
  verified:!!u.verified,
  coins:Number(u.coins)||0,
  avatar:u.avatar||"",
  bio:u.bio||"",
  createdAt:u.createdAt
 };
}

function sellerOf(p){
 return data.users.find(x=>x.id===p.sellerId);
}

const ACCOUNT_SECRET_FILE=path.join(STORAGE,"account-secret.key");

function accountKey(){
 if(!fs.existsSync(ACCOUNT_SECRET_FILE)){
  fs.writeFileSync(
   ACCOUNT_SECRET_FILE,
   crypto.randomBytes(32),
   {flag:"wx"}
  );
 }

 const key=fs.readFileSync(ACCOUNT_SECRET_FILE);

 if(key.length!==32){
  throw new Error("Khóa tài khoản không hợp lệ");
 }

 return key;
}

function encryptAccountPassword(value){
 const iv=crypto.randomBytes(12);

 const cipher=crypto.createCipheriv(
  "aes-256-gcm",
  accountKey(),
  iv
 );

 const encrypted=Buffer.concat([
  cipher.update(String(value),"utf8"),
  cipher.final()
 ]);

 return {
  iv:iv.toString("base64"),
  data:encrypted.toString("base64"),
  tag:cipher.getAuthTag().toString("base64")
 };
}

function decryptAccountPassword(obj){
 if(!obj||!obj.iv||!obj.data||!obj.tag){
  return "";
 }

 const decipher=crypto.createDecipheriv(
  "aes-256-gcm",
  accountKey(),
  Buffer.from(obj.iv,"base64")
 );

 decipher.setAuthTag(
  Buffer.from(obj.tag,"base64")
 );

 const decrypted=Buffer.concat([
  decipher.update(Buffer.from(obj.data,"base64")),
  decipher.final()
 ]);

 return decrypted.toString("utf8");
}
function safeProduct(p){
 if(!p)return null;

 const s=sellerOf(p);

 return {
  id:p.id,
  name:p.name,
  description:p.description||"",
  price:Number(p.price)||0,
  mode:p.mode||"sell",
  category:p.category||"Khác",
  tags:p.tags||[],
  version:p.version||"1.0",
  fileSize:p.fileSize||0,
  format:p.format||"",
  preview:p.preview||"",
  video:p.video||"",
  images:p.images||[],
  originalFilename:p.originalFilename||"",
  sellerId:p.sellerId,
  sellerName:s?s.name:"Shop",
  sellerVerified:!!(s&&s.verified),
  sellerAvatar:s?s.avatar||"":"",
  hidden:!!p.hidden,
  rating:averageRating(p.id),
  reviews:data.reviews.filter(r=>r.productId===p.id).length,
  createdAt:p.createdAt,
  updatedAt:p.updatedAt||p.createdAt
 };
}

function averageRating(pid){
 const rs=data.reviews.filter(x=>x.productId===pid);

 if(!rs.length)return 0;

 return Math.round(
  rs.reduce((a,b)=>a+Number(b.rating||0),0)/rs.length*10
 )/10;
}

function requireUser(req,res,next){
 const u=user(req);

 if(!u){
  return res.status(401).json({error:"Chưa đăng nhập"});
 }

 if(u.banned){
  req.session.userId=null;
  return res.status(403).json({error:"Tài khoản đã bị khóa"});
 }

 req.user=u;
 next();
}

function requireSeller(req,res,next){
 requireUser(req,res,()=>{
  if(
   req.user.role!=="seller"||
   req.user.sellerStatus!=="approved"
  ){
   return res.status(403).json({error:"Shop chưa được Admin duyệt"});
  }

  next();
 });
}

function requireSellerApproved(req,res,next){
 if(!req.session.userId){
  return res.status(401).json({error:"Bạn chưa đăng nhập"});
 }

 const u=data.users.find(x=>x.id===req.session.userId);

 if(!u){
  return res.status(401).json({error:"Tài khoản không tồn tại"});
 }

 if(u.role!=="seller" || u.sellerStatus!=="approved"){
  return res.status(403).json({error:"Chỉ Shop đã được Admin duyệt mới được đăng sản phẩm"});
 }

 next();
}
function requireAdmin(req,res,next){
 if(!req.session.admin){
  return res.status(401).json({error:"Admin chưa đăng nhập"});
 }

 next();
}

function notify(uid,title,message){
 data.notifications.push({
  id:id(),
  userId:uid,
  title,
  message,
  read:false,
  createdAt:now()
 });
}

function addOrderBuyerNotification(o){
 notify(
  o.buyerId,
  "Đơn hàng đã được xác nhận",
  "Đơn "+o.id+" đã được thanh toán."
 );
}

app.get("/api/config",(req,res)=>{
 res.json(data.settings);
});

app.get("/api/me",(req,res)=>{
 const u=data.users.find(x=>x.id===req.session.userId);

 if(!u){
  return res.json({user:null});
 }

 if(u.banned){
  req.session.userId=null;
  return res.json({user:null});
 }

 res.json({
  user:safeUser(u)
 });
});

app.post("/api/register",async(req,res)=>{
 try{
  const name=String(req.body?.name||"").trim();
  const email=String(req.body?.email||"").trim().toLowerCase();
  const password=String(req.body?.password||"");

  if(name.length<2){
   return res.status(400).json({
    error:"Tên phải có ít nhất 2 ký tự"
   });
  }

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
   return res.status(400).json({
    error:"Email không hợp lệ"
   });
  }

  if(password.length<6){
   return res.status(400).json({
    error:"Mật khẩu phải có ít nhất 6 ký tự"
   });
  }

  const exists=data.users.find(x=>
   String(x.email||"").toLowerCase()===email
  );

  if(exists){
   return res.status(409).json({
    error:"Email đã tồn tại"
   });
  }

  const u={
   id:id(),
   name,
   email,
   passwordHash:await bcrypt.hash(password,12),
   role:"user",
   sellerStatus:"none",
   verified:false,
   banned:false,
   coins:0,
   avatar:"",
   bio:"",
   createdAt:now()
  };

  data.users.push(u);
  save();

  req.session.regenerate(err=>{
   if(err){
    return res.status(500).json({
     error:"Không tạo được phiên đăng nhập"
    });
   }

   req.session.userId=u.id;

   req.session.save(err2=>{
    if(err2){
     return res.status(500).json({
      error:"Không lưu được phiên đăng nhập"
     });
    }

    res.json({
     ok:true,
     user:safeUser(u)
    });
   });
  });

 }catch(e){
  console.error("REGISTER ERROR:",e);

  res.status(500).json({
   error:"Lỗi máy chủ khi đăng ký"
  });
 }
});

app.post("/api/login",async(req,res)=>{
 try{
  const email=String(req.body?.email||"").trim().toLowerCase();
  const password=String(req.body?.password||"");

  if(!email||!password){
   return res.status(400).json({
    error:"Vui lòng nhập email và mật khẩu"
   });
  }

  const u=data.users.find(x=>
   String(x.email||"").trim().toLowerCase()===email
  );

  if(!u){
   return res.status(401).json({
    error:"Email hoặc mật khẩu sai"
   });
  }

  if(u.banned){
   return res.status(403).json({
    error:"Tài khoản đã bị khóa"
   });
  }

  if(!u.passwordHash){
   return res.status(500).json({
    error:"Tài khoản bị thiếu mật khẩu. Hãy tạo tài khoản mới."
   });
  }

  const ok=await bcrypt.compare(
   password,
   u.passwordHash
  );

  if(!ok){
   return res.status(401).json({
    error:"Email hoặc mật khẩu sai"
   });
  }

  req.session.regenerate(err=>{
   if(err){
    console.error("SESSION REGENERATE:",err);

    return res.status(500).json({
     error:"Không tạo được phiên đăng nhập"
    });
   }

   req.session.userId=u.id;

   req.session.save(err2=>{
    if(err2){
     console.error("SESSION SAVE:",err2);

     return res.status(500).json({
      error:"Không lưu được phiên đăng nhập"
     });
    }

    res.json({
     ok:true,
     user:safeUser(u)
    });
   });
  });

 }catch(e){
  console.error("LOGIN ERROR:",e);

  res.status(500).json({
   error:"Lỗi máy chủ khi đăng nhập"
  });
 }
});


/* ================= USER PASSWORD ================= */

app.post("/api/password",requireUser,async(req,res)=>{
 try{
  const current=String(req.body.current||"");
  const next=String(req.body.next||"");

  if(!current||!next){
   return res.status(400).json({
    error:"Vui lòng nhập đầy đủ mật khẩu"
   });
  }

  if(next.length<6){
   return res.status(400).json({
    error:"Mật khẩu mới tối thiểu 6 ký tự"
   });
  }

  if(!req.user.passwordHash){
   return res.status(500).json({
    error:"Tài khoản chưa có mật khẩu hợp lệ"
   });
  }

  const ok=await bcrypt.compare(
   current,
   req.user.passwordHash
  );

  if(!ok){
   return res.status(400).json({
    error:"Mật khẩu hiện tại sai"
   });
  }

  req.user.passwordHash=await bcrypt.hash(next,12);

  save();

  res.json({
   ok:true
  });

 }catch(e){
  console.error("CHANGE PASSWORD ERROR:",e);

  res.status(500).json({
   error:"Không đổi được mật khẩu"
  });
 }
});

app.post("/api/logout",(req,res)=>{
 req.session.destroy(err=>{
  if(err){
   return res.status(500).json({
    error:"Không đăng xuất được"
   });
  }

  res.clearCookie("connect.sid",{
   httpOnly:true,
   sameSite:"lax",
   secure:"auto"
  });

  res.json({ok:true});
 });
});

/* ================= SELLER ================= */

app.post("/api/seller/apply",requireUser,(req,res)=>{
 if(req.user.sellerStatus==="pending"){
  return res.status(400).json({error:"Đang chờ Admin duyệt"});
 }

 if(req.user.sellerStatus==="approved"){
  return res.status(400).json({error:"Bạn đã là Shop"});
 }

 req.user.sellerStatus="pending";
 save();

 notify(
  req.user.id,
  "Đã gửi đơn Shop",
  "Đơn đăng ký Shop đang chờ Admin duyệt."
 );

 save();

 res.json({ok:true});
});

app.get("/api/seller/dashboard",requireSeller,(req,res)=>{
 const products=data.products.filter(x=>x.sellerId===req.user.id);
 const orders=data.orders.filter(o=>
  products.some(p=>p.id===o.productId)
 );

 const gross=orders
  .filter(o=>o.status==="paid")
  .reduce((a,b)=>a+Number(b.amount||0),0);

 const fee=gross*Number(data.settings.commission??10)/100;

 res.json({
  products:products.map(safeProduct),
  orders,
  gross,
  fee,
  net:gross-fee
 });
});

app.post("/api/seller/profile",requireSeller,(req,res)=>{
 req.user.name=String(req.body.name||req.user.name).trim();
 req.user.bio=String(req.body.bio||"");
 req.user.avatar=String(req.body.avatar||"");
 save();

 res.json({user:safeUser(req.user)});
});

/* ================= PRODUCTS ================= */

app.get("/api/products",(req,res)=>{
 const q=String(req.query.q||"").toLowerCase();
 const category=String(req.query.category||"").toLowerCase();

 let result=data.products.filter(p=>!p.hidden);

 if(q){
  result=result.filter(p=>
   (
    p.name+" "+
    p.description+" "+
    (p.tags||[]).join(" ")
   ).toLowerCase().includes(q)
  );
 }

 if(category){
  result=result.filter(p=>
   String(p.category||"").toLowerCase()===category
  );
 }

 res.json(result.map(safeProduct));
});

app.get("/api/products/:id",(req,res)=>{
 const p=data.products.find(x=>x.id===req.params.id&&!x.hidden);

 if(!p){
  return res.status(404).json({error:"Không tìm thấy sản phẩm"});
 }

 res.json({
  product:safeProduct(p),
  reviews:data.reviews
   .filter(r=>r.productId===p.id)
   .map(r=>({
    ...r,
    user:safeUser(data.users.find(u=>u.id===r.userId))
   }))
 });
});

app.post("/api/products",requireSellerApproved,requireSeller,productUploadMiddleware,(req,res)=>{
 const files=Object.values(req.files||{}).flat();
 const mainFiles=files.filter(f=>f.fieldname==="file");
 const images=files.filter(f=>f.fieldname==="image");
 const video=files.find(f=>f.fieldname==="video");
 const category=String(req.body.category||"Khác").trim();
 const isAccount=category==="Tài khoản";
 const accountUsername=String(req.body.accountUsername||"").trim();
 const accountPassword=String(req.body.accountPassword||"");
 const cleanup=()=>{for(const f of files){try{fs.unlinkSync(f.path);}catch{}}};
 const name=String(req.body.name||"").trim();
 const price=Math.max(0,Number(req.body.price)||0);
 const mode=String(req.body.mode||"sell");
 const totalSize=mainFiles.reduce((n,f)=>n+Number(f.size||0),0);

 if(!name){cleanup();return res.status(400).json({error:"Chưa nhập tên sản phẩm"});}
 if(!["sell","paid","free","both"].includes(mode)){cleanup();return res.status(400).json({error:"Loại bán không hợp lệ"});}
 if(totalSize>3*1024*1024*1024){cleanup();return res.status(413).json({error:"Tổng dung lượng file sản phẩm tối đa 3 GB"});}
 if(!isAccount&&!mainFiles.length){cleanup();return res.status(400).json({error:"Chưa chọn file sản phẩm"});}
 if(isAccount&&(!accountUsername||!accountPassword)){cleanup();return res.status(400).json({error:"Tài khoản phải có tên đăng nhập và mật khẩu"});}
 if(isAccount&&mainFiles.length){cleanup();return res.status(400).json({error:"Sản phẩm tài khoản không cần file sản phẩm"});}

 let storedFilename="",originalFilename="",format=isAccount?"ACCOUNT":"",fileSize=0,createdZip=null;
 try{
  if(mainFiles.length===1){
   storedFilename=mainFiles[0].filename;
   originalFilename=mainFiles[0].originalname;
   fileSize=mainFiles[0].size;
   format=path.extname(mainFiles[0].originalname).replace(".","").toUpperCase();
  }else if(mainFiles.length>1){
   const zipName=id()+".zip",zipPath=path.join(PRODUCTS,zipName);
   createZipFromFiles(mainFiles.map((f,i)=>({path:f.path,name:f.originalname||`file-${i+1}`})),zipPath);
   for(const f of mainFiles){try{fs.unlinkSync(f.path);}catch{}}
   storedFilename=zipName;
   originalFilename=(name.replace(/[\\/:*?"<>|]/g,"_").slice(0,100)||"product")+".zip";
   fileSize=fs.statSync(zipPath).size;format="ZIP";createdZip=zipPath;
  }
  const p={
   id:id(),sellerId:req.user.id,name,
   description:String(req.body.description||"").slice(0,20000),
   price,mode,category,
   tags:String(req.body.tags||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,50),
   version:String(req.body.version||"1.0").slice(0,100),
   format,fileSize,preview:String(req.body.preview||"").slice(0,500),
   video:video?"/media/video/"+video.filename:"",
   images:images.map(f=>"/media/image/"+f.filename),
   storedFilename,originalFilename,
   account:isAccount?{username:accountUsername,password:encryptAccountPassword(accountPassword)}:null,
   hidden:false,sold:false,createdAt:now(),updatedAt:now()
  };
  data.products.push(p);save();res.json({product:safeProduct(p)});
 }catch(e){
  if(createdZip){try{fs.unlinkSync(createdZip);}catch{}}
  cleanup();
  return res.status(500).json({error:"Không thể lưu sản phẩm: "+(e.message||"lỗi không xác định")});
 }
});

app.get("/media/image/:name",(req,res)=>{
 const file=path.join(IMAGES,path.basename(req.params.name));

 if(!fs.existsSync(file)){
  return res.status(404).end();
 }

 res.sendFile(file);
});

app.get("/media/video/:name",(req,res)=>{
 const file=path.join(VIDEOS,path.basename(req.params.name));

 if(!fs.existsSync(file)){
  return res.status(404).end();
 }

 res.sendFile(file);
});

/* ================= WALLET / PAYMENT V2.2 ================= */

function walletTransaction(userId,type,amount,ref,note,meta={}){
 const tx={
  id:"TX-"+crypto.randomUUID(),
  userId,
  type,
  amount:Number(amount)||0,
  ref:String(ref||""),
  note:String(note||""),
  meta,
  createdAt:now()
 };

 data.walletTransactions.push(tx);
 return tx;
}

function creditCoins(userId,amount,ref,note,meta={}){
 amount=Number(amount)||0;

 if(amount<=0){
  throw new Error("Số Coin không hợp lệ");
 }

 const u=data.users.find(x=>x.id===userId);

 if(!u){
  throw new Error("Không tìm thấy tài khoản");
 }

 if(data.walletTransactions.some(x=>
  x.userId===userId &&
  x.type==="credit" &&
  x.ref===String(ref)
 )){
  return false;
 }

 u.coins=Number(u.coins||0)+amount;

 walletTransaction(
  userId,
  "credit",
  amount,
  ref,
  note,
  meta
 );

 return true;
}

function debitCoins(userId,amount,ref,note,meta={}){
 amount=Number(amount)||0;

 if(amount<=0){
  throw new Error("Số Coin không hợp lệ");
 }

 const u=data.users.find(x=>x.id===userId);

 if(!u){
  throw new Error("Không tìm thấy tài khoản");
 }

 if(data.walletTransactions.some(x=>
  x.userId===userId &&
  x.type==="debit" &&
  x.ref===String(ref)
 )){
  return true;
 }

 if(Number(u.coins||0)<amount){
  throw new Error("Không đủ Coin");
 }

 u.coins=Number(u.coins||0)-amount;

 walletTransaction(
  userId,
  "debit",
  amount,
  ref,
  note,
  meta
 );

 return true;
}

function topupAlreadyCompleted(ref){
 return data.topups.some(x=>
  x.reference===String(ref)&&
  x.status==="success"
 );
}

function completeTopup(t){
 if(!t)return false;

 if(t.status==="success"){
  return true;
 }

 if(topupAlreadyCompleted(t.reference)){
  t.status="duplicate";
  save();
  return false;
 }

 creditCoins(
  t.userId,
  t.coins,
  t.reference,
  "Nạp Coin thành công",
  {
   method:t.method,
   topupId:t.id
  }
 );

 t.status="success";
 t.completedAt=now();

 save();

 notify(
  t.userId,
  "Nạp Coin thành công",
  "Bạn đã nhận "+Number(t.coins).toLocaleString("vi-VN")+" Coin."
 );

 save();

 return true;
}

/* Ví */
app.get("/api/wallet",requireUser,(req,res)=>{
 res.json({
  coins:Number(req.user.coins)||0,
  currency:"Coin"
 });
});

app.get("/api/wallet/transactions",requireUser,(req,res)=>{
 res.json(
  data.walletTransactions
   .filter(x=>x.userId===req.user.id)
   .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
   .slice(0,200)
 );
});

/* Danh sách phương thức thanh toán */
app.get("/api/payment-methods",(req,res)=>{
 res.json({
  bankAccounts:data.settings.bankAccounts||[],
  bankName:data.settings.bankName||"",
  bankAccount:data.settings.bankAccount||"",
  bankOwner:data.settings.bankOwner||"",
  paymentNote:data.settings.paymentNote||"",
  zalopay:!!(
   process.env.ZALOPAY_APP_ID &&
   process.env.ZALOPAY_CALLBACK_KEY
  ),
  cardProvider:!!process.env.CARD_API_URL
 });
});

/* Tạo yêu cầu nạp qua ngân hàng */
app.post("/api/topups/bank",requireUser,(req,res)=>{
 const amount=Math.floor(Number(req.body.amount)||0);

 if(amount<1000){
  return res.status(400).json({
   error:"Số tiền nạp tối thiểu là 1.000đ"
  });
 }

 const reference=
  "FMN"+Date.now().toString(36).toUpperCase()+
  crypto.randomBytes(3).toString("hex").toUpperCase();

 const t={
  id:id(),
  userId:req.user.id,
  method:"bank",
  amount,
  coins:amount,
  reference,
  status:"pending",
  createdAt:now()
 };

 data.topups.push(t);
 save();

 res.json({
  ok:true,
  topup:t,
  payment:{
   bankAccounts:data.settings.bankAccounts||[],
   bankName:data.settings.bankName,
   bankAccount:data.settings.bankAccount,
   bankOwner:data.settings.bankOwner,
   note:String(data.settings.paymentNote||"")
    .replaceAll("{REFERENCE}",reference)
    .replaceAll("{AMOUNT}",String(amount))
  }
 });
});

/* Nạp thẻ cào.
   API provider phải trả JSON dạng:
   { success:true, transactionId:"...", amount:50000 }
*/
app.post("/api/topups/card",requireUser,async(req,res)=>{
 const network=String(req.body.network||"").trim();
 const serial=String(req.body.serial||"").trim();
 const code=String(req.body.code||"").trim();
 const amount=Math.floor(Number(req.body.amount)||0);

 if(!network||!serial||!code||amount<=0){
  return res.status(400).json({
   error:"Thiếu nhà mạng, serial, mã thẻ hoặc mệnh giá"
  });
 }

 const reference=
  "CARD"+Date.now().toString(36).toUpperCase()+
  crypto.randomBytes(3).toString("hex").toUpperCase();

 const networkKey=network.toLowerCase();

 const isMobi=networkKey.includes("mobi");

 const otherDiscount=Math.min(
  10,
  Math.max(
   5,
   Number(data.settings.cardOtherDiscountPercent??10)
  )
 );

 const cardDiscount=isMobi?0:otherDiscount;

 const cardCoins=Math.floor(
  amount*(100-cardDiscount)/100
 );
 const t={
  id:id(),
  userId:req.user.id,
  method:"card",
  network,
  serial,
  code,
  amount,
  coins:cardCoins,
  discountPercent:cardDiscount,
  reference,
  status:"pending",
  createdAt:now()
 };

 data.topups.push(t);
 save();

 if(!process.env.CARD_API_URL){
  return res.json({
   ok:true,
   status:"pending",
   message:"Đã ghi nhận thẻ. Admin cần xác nhận vì chưa cấu hình Card Provider."
  });
 }

 try{
  const rr=await fetch(
   process.env.CARD_API_URL,
   {
    method:"POST",
    headers:{
     "Content-Type":"application/json",
     ...(process.env.CARD_API_KEY?
       {"Authorization":"Bearer "+process.env.CARD_API_KEY}:{})
    },
    body:JSON.stringify({
     reference,
     network,
     serial,
     code,
     amount
    })
   }
  );

  const d=await rr.json().catch(()=>({}));

  if(d.success===true){
   if(Number(d.amount)!==amount){
    t.status="failed";
    t.failReason="Mệnh giá provider trả về không khớp";
    save();

    return res.status(400).json({
     error:"Mệnh giá thẻ không khớp"
    });
   }

   t.providerTransactionId=String(d.transactionId||"");

   completeTopup(t);

   return res.json({
    ok:true,
    status:"success",
    coins:t.coins
   });
  }

  t.status="failed";
  t.failReason=String(d.message||"Provider từ chối thẻ");
  save();

  return res.status(400).json({
   error:t.failReason
  });

 }catch(e){
  t.status="pending";
  t.failReason="Provider tạm thời không phản hồi";
  save();

  return res.status(202).json({
   ok:true,
   status:"pending",
   message:"Thẻ đang chờ provider xác nhận."
  });
 }
});

/*
 ZaloPay callback.

 ZaloPay callback gửi:
 data = JSON string
 mac  = chữ ký
 type = loại callback

 Callback key lấy từ tài khoản Merchant.
*/
app.post("/api/payment/zalopay/callback",(req,res)=>{
 try{
  const raw=String(req.body.data||"");
  const mac=String(req.body.mac||"");

  if(!raw||!mac||!process.env.ZALOPAY_CALLBACK_KEY){
   return res.json({
    return_code:-1,
    return_message:"INVALID_CONFIG"
   });
  }

  const expected=crypto
   .createHmac(
    "sha256",
    process.env.ZALOPAY_CALLBACK_KEY
   )
   .update(raw)
   .digest("hex");

  if(
   !crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(mac)
   )
  ){
   return res.json({
    return_code:-1,
    return_message:"INVALID_MAC"
   });
  }

  const d=JSON.parse(raw);

  const reference=String(
   d.mcRefId||
   d.merchant_order_id||
   ""
  );

  const t=data.topups.find(x=>
   x.reference===reference
  );

  if(!t){
   return res.json({
    return_code:-1,
    return_message:"TOPUP_NOT_FOUND"
   });
  }

  if(t.status==="success"){
   return res.json({
    return_code:1,
    return_message:"OK"
   });
  }

  const paidAmount=Number(d.amount||0);

  if(paidAmount!==Number(t.amount)){
   t.status="failed";
   t.failReason="Số tiền callback không khớp";
   save();

   return res.json({
    return_code:-1,
    return_message:"AMOUNT_MISMATCH"
   });
  }

  t.providerTransactionId=String(d.zpTransId||"");

  completeTopup(t);

  return res.json({
   return_code:1,
   return_message:"OK"
  });

 }catch(e){
  return res.json({
   return_code:-1,
   return_message:"ERROR"
  });
 }
});

/* Admin xem topup */
app.get("/api/admin/topups",requireAdmin,(req,res)=>{
 res.json(
  data.topups
   .slice()
   .reverse()
   .map(t=>({
    ...t,
    user:safeUser(
     data.users.find(u=>u.id===t.userId)
    )
   }))
 );
});

/* Admin duyệt nạp */
app.post("/api/admin/topups/:id/approve",requireAdmin,(req,res)=>{
 const t=data.topups.find(x=>x.id===req.params.id);

 if(!t){
  return res.status(404).json({
   error:"Không tìm thấy giao dịch"
  });
 }

 if(t.status==="success"){
  return res.json({
   ok:true,
   already:true
  });
 }

 completeTopup(t);

 res.json({
  ok:true,
  status:t.status
 });
});

/* Admin từ chối nạp */
app.post("/api/admin/topups/:id/reject",requireAdmin,(req,res)=>{
 const t=data.topups.find(x=>x.id===req.params.id);

 if(!t){
  return res.status(404).json({
   error:"Không tìm thấy giao dịch"
  });
 }

 if(t.status==="success"){
  return res.status(400).json({
   error:"Không thể từ chối giao dịch đã thành công"
  });
 }

 t.status="failed";
 t.failReason=String(req.body.reason||"Admin từ chối");
 t.rejectedAt=now();

 save();

 res.json({
  ok:true
 });
});

/* ================= ORDERS ================= */

app.post("/api/orders",requireUser,(req,res)=>{
 const p=data.products.find(x=>
  x.id===req.body.productId&&!x.hidden
 );

 if(!p){
  return res.status(404).json({
   error:"Sản phẩm không tồn tại"
  });
 }

 /* ===== ACCOUNT: CHỈ BÁN 1 LẦN ===== */

 if(
  p.category==="Tài khoản" &&
  (
   p.sold===true ||
   data.orders.some(o=>
    o.productId===p.id &&
    o.status==="paid"
   )
  )
 ){
  return res.status(400).json({
   error:"Tài khoản này đã được bán"
  });
 }

 /* ===== FREE ===== */

 if(p.mode==="free"){
  const o={
   id:"FM-"+Date.now().toString(36).toUpperCase(),
   buyerId:req.user.id,
   productId:p.id,
   amount:0,
   originalAmount:0,
   discountAmount:0,
   type:"free",
   status:"paid",
   createdAt:now()
  };

  data.orders.push(o);
  save();

  return res.json({
   order:o
  });
 }

 const productMode=p.mode||"sell";

 if(!["sell","both","paid"].includes(productMode)){
  return res.status(400).json({
   error:"Sản phẩm không hỗ trợ mua"
  });
 }

 const originalAmount=Math.max(
  0,
  Number(p.price)||0
 );

 if(originalAmount<=0){
  return res.status(400).json({
   error:"Giá sản phẩm không hợp lệ"
  });
 }


 /* ===== VOUCHER ===== */

 let voucher=null;
 let discountAmount=0;

 const voucherCode=String(
  req.body.voucherCode||""
 ).trim().toUpperCase();

 if(voucherCode){

  if(!Array.isArray(data.vouchers)){
   data.vouchers=[];
  }

  voucher=data.vouchers.find(v=>
   String(v.code||"").toUpperCase()===voucherCode
  );

  if(!voucher){
   return res.status(400).json({
    error:"Voucher không tồn tại"
   });
  }

  if(voucher.active===false){
   return res.status(400).json({
    error:"Voucher đã bị tắt"
   });
  }

  const used=Number(voucher.used||0);
  const maxUses=Number(voucher.maxUses||0);

  if(maxUses>0&&used>=maxUses){
   return res.status(400).json({
    error:"Voucher đã hết lượt sử dụng"
   });
  }

  const percent=Math.min(
   100,
   Math.max(0,Number(voucher.percent)||0)
  );

  discountAmount=Math.floor(
   originalAmount*percent/100
  );
 }

 const amount=Math.max(
  0,
  originalAmount-discountAmount
 );


 /* ===== ORDER ===== */

 const o={
  id:"FM-"+Date.now().toString(36).toUpperCase(),
  buyerId:req.user.id,
  productId:p.id,

  originalAmount,
  discountAmount,
  amount,

  voucherId:voucher?.id||null,
  voucherCode:voucher?.code||null,

  type:"buy",
  status:"pending",
  createdAt:now()
 };


 try{

  /*
   * Trừ Coin theo GIÁ SAU GIẢM.
   * Voucher 100% => amount = 0, không gọi debitCoins(0).
   */
  if(amount>0){
   debitCoins(
    req.user.id,
    amount,
    "ORDER:"+o.id,
    "Mua "+p.name,
    {
     orderId:o.id,
     productId:p.id,
     originalAmount,
     discountAmount,
     voucherCode:voucher?.code||null
    }
   );
  }


  const seller=data.users.find(x=>x.id===p.sellerId);
  const commissionPercent=Math.min(100,Math.max(0,Number(data.settings.commission??10)));
  const commission=Math.floor(amount*commissionPercent/100);
  const sellerAmount=Math.max(0,amount-commission);

  if(seller&&seller.id!==req.user.id&&sellerAmount>0){
   seller.coins=Number(seller.coins||0)+sellerAmount;
   walletTransaction(
    seller.id,"credit",sellerAmount,"SALE:"+o.id,
    "Doanh thu bán "+p.name,
    {orderId:o.id,gross:originalAmount,discount:discountAmount,sellerAmount,commission}
   );
  }

  /*
   * Voucher chỉ tính là đã dùng sau khi
   * thanh toán thành công.
   */
  if(voucher){
   voucher.used=
    Number(voucher.used||0)+1;
  }


  /* ===== ACCOUNT: ĐÁNH DẤU ĐÃ BÁN ===== */

  if(p.category==="Tài khoản"){
   p.sold=true;
   p.soldAt=now();
   p.soldTo=req.user.id;
   p.hidden=true;
  }

  o.status="paid";
  o.paidAt=now();
  o.commission=commission;
  o.commissionPercent=commissionPercent;
  o.sellerAmount=sellerAmount;

  data.orders.push(o);

  save();

  addOrderBuyerNotification(o);

  if(seller&&seller.id!==req.user.id){
   notify(
    seller.id,
    "Có đơn hàng mới",
    "Bạn vừa bán "+p.name
   );
  }

  save();

  return res.json({
   order:o,
   paidWith:"coin",
   coins:req.user.coins
  });

 }catch(e){

  return res.status(400).json({
   error:e.message||"Không thể thanh toán"
  });

 }
});

app.get("/api/my/orders",requireUser,(req,res)=>{
 res.json(
  data.orders
   .filter(o=>o.buyerId===req.user.id)
   .map(o=>({
    ...o,
    product:safeProduct(
     data.products.find(p=>p.id===o.productId)
    )
   }))
 );
});

/* ================= DOWNLOAD ================= */

app.get("/download/:id",requireUser,(req,res)=>{
 const p=data.products.find(x=>x.id===req.params.id);

 if(!p){
  return res.status(404).send("File không tồn tại");
 }

 const own=p.sellerId===req.user.id;

 const paid=data.orders.some(o=>
  o.productId===p.id&&
  o.buyerId===req.user.id&&
  o.status==="paid"
 );


 if(!own&&!paid){
  return res.status(403).send("Bạn chưa có quyền tải file");
 }

 const file=path.join(PRODUCTS,p.storedFilename);

 if(!fs.existsSync(file)){
  return res.status(404).send("File không còn trên máy chủ");
 }

 res.download(file,p.originalFilename);
});

/* ================= ACCOUNT ORDER ================= */

app.get("/api/my/orders/:id/account",requireUser,(req,res)=>{
 const o=data.orders.find(x=>
  x.id===req.params.id&&
  x.buyerId===req.user.id&&
  x.status==="paid"
 );

 if(!o){
  return res.status(404).json({error:"Không tìm thấy đơn hàng hoặc bạn chưa thanh toán"});
 }

 const p=data.products.find(x=>x.id===o.productId);

 if(!p||p.category!=="Tài khoản"||!p.account){
  return res.status(400).json({error:"Đơn hàng này không phải sản phẩm tài khoản"});
 }

 try{
  const password=decryptAccountPassword(p.account.password);

  return res.json({
   username:String(p.account.username||""),
   password:String(password||"")
  });
 }catch(e){
  return res.status(500).json({error:"Không thể lấy thông tin tài khoản"});
 }
});
/* ================= CART ================= */

app.get("/api/cart",requireUser,(req,res)=>{
 const c=data.carts.find(x=>x.userId===req.user.id);

 const ids=c?c.productIds:[];

 res.json(
  ids
   .map(pid=>data.products.find(p=>p.id===pid))
   .filter(Boolean)
   .map(safeProduct)
 );
});

app.post("/api/cart/toggle",requireUser,(req,res)=>{
 let c=data.carts.find(x=>x.userId===req.user.id);

 if(!c){
  c={
   id:id(),
   userId:req.user.id,
   productIds:[]
  };

  data.carts.push(c);
 }

 const pid=req.body.productId;

 if(c.productIds.includes(pid)){
  c.productIds=c.productIds.filter(x=>x!==pid);
 }else{
  c.productIds.push(pid);
 }

 save();

 res.json({ids:c.productIds});
});

/* ================= FAVORITES ================= */

app.get("/api/favorites",requireUser,(req,res)=>{
 res.json(
  data.favorites
   .filter(x=>x.userId===req.user.id)
   .map(x=>safeProduct(
    data.products.find(p=>p.id===x.productId)
   ))
   .filter(Boolean)
 );
});

app.post("/api/favorites/toggle",requireUser,(req,res)=>{
 const i=data.favorites.findIndex(x=>
  x.userId===req.user.id&&
  x.productId===req.body.productId
 );

 if(i>=0){
  data.favorites.splice(i,1);
 }else{
  data.favorites.push({
   id:id(),
   userId:req.user.id,
   productId:req.body.productId,
   createdAt:now()
  });
 }

 save();

 res.json({ok:true});
});

/* ================= REVIEWS ================= */

app.post("/api/reviews",requireUser,(req,res)=>{
 const pid=req.body.productId;
 const rating=Math.min(5,Math.max(1,Number(req.body.rating)||1));

 const owns=data.orders.some(o=>
  o.buyerId===req.user.id&&
  o.productId===pid&&
  o.status==="paid"
 );


 if(!owns){
  return res.status(403).json({error:"Bạn chưa mua sản phẩm"});
 }

 const old=data.reviews.find(x=>
  x.userId===req.user.id&&x.productId===pid
 );

 if(old){
  old.rating=rating;
  old.text=String(req.body.text||"");
  old.updatedAt=now();
 }else{
  data.reviews.push({
   id:id(),
   userId:req.user.id,
   productId:pid,
   rating,
   text:String(req.body.text||""),
   createdAt:now()
  });
 }

 save();

 res.json({ok:true});
});

app.get("/api/users/:id",requireUser,(req,res)=>{
 const u=data.users.find(x=>x.id===req.params.id);
 if(!u)return res.status(404).json({error:"Không tìm thấy người dùng"});
 res.json(safeUser(u));
});

/* ================= CHAT ================= */

app.get("/api/chats/:shopId",requireUser,(req,res)=>{
 const shop=data.users.find(x=>x.id===req.params.shopId);

 if(!shop){
  return res.status(404).json({error:"Shop không tồn tại"});
 }

 const msgs=data.messages.filter(m=>
  (m.fromId===req.user.id&&m.toId===shop.id)||
  (m.fromId===shop.id&&m.toId===req.user.id)
 );

 res.json(msgs);
});

app.post("/api/chats/:shopId",requireUser,(req,res)=>{
 const shop=data.users.find(x=>x.id===req.params.shopId);

 if(!shop){
  return res.status(404).json({error:"Shop không tồn tại"});
 }

 const text=String(req.body.text||"").trim();

 if(!text){
  return res.status(400).json({error:"Tin nhắn trống"});
 }

 const m={
  id:id(),
  fromId:req.user.id,
  toId:shop.id,
  text,
  productId:req.body.productId||null,
  createdAt:now()
 };

 data.messages.push(m);

 notify(
  shop.id,
  "Tin nhắn mới",
  req.user.name+" đã gửi tin nhắn."
 );

 save();

 res.json({message:m});
});

app.get("/api/chats",requireUser,(req,res)=>{
 const ids=new Set();

 for(const m of data.messages){
  if(m.fromId===req.user.id)ids.add(m.toId);
  if(m.toId===req.user.id)ids.add(m.fromId);
 }

 const result=[...ids].map(uid=>{
  const u=data.users.find(x=>x.id===uid);

  const messages=data.messages
   .filter(m=>
    (m.fromId===req.user.id&&m.toId===uid)||
    (m.fromId===uid&&m.toId===req.user.id)
   )
   .sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));

  return {
   user:safeUser(u),
   last:messages.at(-1)||null
  };
 });

 res.json(result);
});

/* ================= NOTIFICATIONS ================= */

app.get("/api/notifications",requireUser,(req,res)=>{
 res.json(
  data.notifications
   .filter(x=>x.userId===req.user.id)
   .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
 );
});

app.post("/api/notifications/read",requireUser,(req,res)=>{
 for(const n of data.notifications){
  if(n.userId===req.user.id)n.read=true;
 }

 save();

 res.json({ok:true});
});

/* ================= ADMIN ================= */

app.post("/api/admin/login",async(req,res)=>{
 const ok=await bcrypt.compare(
  String(req.body.password||""),
  data.adminPasswordHash
 );

 if(!ok){
  return res.status(401).json({error:"Sai mật khẩu Admin"});
 }

 req.session.admin=true;

 res.json({
  ok:true,
  admin:{
   name:"Admin",
   verified:true,
   role:"admin"
  }
 });
});

app.post("/api/admin/logout",(req,res)=>{
 req.session.admin=false;
 res.json({ok:true});
});

app.get("/api/admin/me",requireAdmin,(req,res)=>{
 res.json({
  ok:true,
  admin:{
   name:"Admin",
   verified:true,
   role:"admin"
  }
 });
});

app.post("/api/admin/password",requireAdmin,async(req,res)=>{
 const current=String(req.body.current||"");
 const next=String(req.body.next||"");

 if(!await bcrypt.compare(current,data.adminPasswordHash)){
  return res.status(400).json({error:"Mật khẩu hiện tại sai"});
 }

 if(next.length<8){
  return res.status(400).json({error:"Mật khẩu mới tối thiểu 8 ký tự"});
 }

 data.adminPasswordHash=await bcrypt.hash(next,12);
 save();

 res.json({ok:true});
});


/* ================= SELLER WITHDRAW ================= */

app.get("/api/seller/withdrawals",requireSeller,(req,res)=>{
 const rows=(data.withdrawals||[])
  .filter(x=>x.userId===req.user.id)
  .slice()
  .reverse();

 res.json({
  coins:Number(req.user.coins||0),
  feePercent:Number(data.settings.withdrawFeePercent??0),
  coinToVnd:Number(data.settings.coinToVnd??1),
  maxWithdrawals7d:Number(data.settings.maxWithdrawals7d??2),
  withdrawals:rows
 });
});

app.post("/api/seller/withdraw",requireSeller,(req,res)=>{
 try{
  if(!Array.isArray(data.withdrawals)){
   data.withdrawals=[];
  }

  const amount=Math.floor(Number(req.body.amount)||0);
  const bankName=String(req.body.bankName||"").trim();
  const bankAccount=String(req.body.bankAccount||"").trim();
  const bankOwner=String(req.body.bankOwner||"").trim();

  if(amount<=0){
   return res.status(400).json({error:"Số Coin rút phải lớn hơn 0"});
  }

  if(!bankName||!bankAccount||!bankOwner){
   return res.status(400).json({
    error:"Vui lòng nhập đầy đủ ngân hàng, số tài khoản và chủ tài khoản"
   });
  }

  const nowMs=Date.now();
  const sevenDays=7*24*60*60*1000;

  const count7d=data.withdrawals.filter(x=>
   x.userId===req.user.id &&
   ["pending","approved"].includes(x.status) &&
   new Date(x.createdAt||0).getTime()>=nowMs-sevenDays
  ).length;

  const max7d=Math.max(
   1,
   Math.floor(Number(data.settings.maxWithdrawals7d??2))
  );

  if(count7d>=max7d){
   return res.status(400).json({
    error:"Bạn đã đạt giới hạn "+max7d+" lần rút trong 7 ngày"
   });
  }

  const owner=data.users.find(x=>x.id===req.user.id);

  if(!owner){
   return res.status(401).json({error:"Không tìm thấy tài khoản"});
  }

  const balance=Number(owner.coins||0);

  if(amount>balance){
   return res.status(400).json({
    error:"Số dư Coin không đủ"
   });
  }

  const coinToVnd=Math.max(
   0,
   Number(data.settings.coinToVnd??1)
  );

  const feePercent=Math.min(
   100,
   Math.max(0,Number(data.settings.withdrawFeePercent??0))
  );

  const grossVnd=amount*coinToVnd;
  const feeVnd=Math.floor(grossVnd*feePercent/100);
  const receiveVnd=grossVnd-feeVnd;

  const w={
   id:id(),
   userId:req.user.id,
   coins:amount,
   coinToVnd,
   grossVnd,
   feePercent,
   feeVnd,
   receiveVnd,
   bankName,
   bankAccount,
   bankOwner,
   status:"pending",
   createdAt:now(),
   processedAt:null,
   processedBy:null,
   note:""
  };

  /* Trừ Coin thật trong data.users ngay khi tạo yêu cầu.
     Không dùng riêng req.user để tránh trường hợp session giữ object cũ. */
  debitCoins(
   owner.id,
   amount,
   "WITHDRAW:"+w.id,
   "Khóa "+amount+" Coin để chờ rút tiền",
   {
    withdrawalId:w.id,
    grossVnd,
    feeVnd,
    receiveVnd
   }
  );

  data.withdrawals.push(w);

  try{
   save();
  }catch(e){
   /* Roll back cả ví, giao dịch và yêu cầu nếu ghi DB thất bại. */
   data.withdrawals.pop();
   data.walletTransactions=data.walletTransactions.filter(x=>x.ref!=="WITHDRAW:"+w.id);
   owner.coins=balance;
   throw e;
  }

  req.user=owner;

  notify(
   req.user.id,
   "Đã tạo yêu cầu rút tiền",
   "Yêu cầu "+w.id+" đang chờ Admin duyệt."
  );

  res.json({
   ok:true,
   withdrawal:w,
   coins:Number(owner.coins||0),
   user:safeUser(owner)
  });

 }catch(e){
  res.status(400).json({
   error:e.message||"Không tạo được yêu cầu rút"
  });
 }
});

/* Admin xem yêu cầu rút */
app.get("/api/admin/withdrawals",requireAdmin,(req,res)=>{
 res.json(
  (data.withdrawals||[])
   .slice()
   .reverse()
   .map(w=>({
    ...w,
    user:safeUser(
     data.users.find(u=>u.id===w.userId)
    )
   }))
 );
});

/* Admin duyệt rút */
app.post("/api/admin/withdrawals/:id/approve",requireAdmin,(req,res)=>{
 const w=(data.withdrawals||[]).find(x=>x.id===req.params.id);

 if(!w){
  return res.status(404).json({error:"Không tìm thấy yêu cầu"});
 }

 if(w.status!=="pending"){
  return res.status(400).json({
   error:"Yêu cầu này đã được xử lý"
  });
 }

 w.status="approved";
 w.processedAt=now();
 w.processedBy="admin";
 w.note=String(req.body.note||"");

 save();

 notify(
  w.userId,
  "Rút tiền đã được duyệt",
  "Admin đã duyệt "+w.id+
  ". Số tiền nhận: "+Number(w.receiveVnd||0).toLocaleString("vi-VN")+"đ"
 );

 res.json({ok:true,withdrawal:w});
});

/* Admin từ chối rút và hoàn Coin */
app.post("/api/admin/withdrawals/:id/reject",requireAdmin,(req,res)=>{
 const w=(data.withdrawals||[]).find(x=>x.id===req.params.id);

 if(!w){
  return res.status(404).json({error:"Không tìm thấy yêu cầu"});
 }

 if(w.status!=="pending"){
  return res.status(400).json({
   error:"Yêu cầu này đã được xử lý"
  });
 }

 const u=data.users.find(x=>x.id===w.userId);

 if(!u){
  return res.status(404).json({
   error:"Không tìm thấy người bán"
  });
 }

 w.status="rejected";
 w.processedAt=now();
 w.processedBy="admin";
 w.note=String(req.body.note||"Từ chối yêu cầu rút");

 const refund=Number(w.coins||0);

 u.coins=Number(u.coins||0)+refund;

 walletTransaction(
  u.id,
  "credit",
  refund,
  "WITHDRAW_REFUND:"+w.id,
  "Hoàn Coin do yêu cầu rút bị từ chối",
  {withdrawalId:w.id}
 );

 save();

 notify(
  u.id,
  "Yêu cầu rút tiền bị từ chối",
  "Coin đã được hoàn lại vào ví."
 );

 res.json({
  ok:true,
  withdrawal:w,
  refunded:refund,
  coins:u.coins
 });
});

app.get("/api/admin/stats",requireAdmin,(req,res)=>{
 const paidOrders=data.orders.filter(x=>x.status==="paid");

 const total=paidOrders.reduce((a,b)=>a+Number(b.amount||0),0);
 const fee=paidOrders.reduce((a,b)=>a+Number(b.commission||0),0);

 res.json({
  users:data.users.length,
  sellers:data.users.filter(x=>x.role==="seller").length,
  products:data.products.length,
  orders:data.orders.length,
  chats:data.messages.length,
  gross:total,
  commission:fee,
  sellerNet:total-fee
 });
});

app.get("/api/admin/users",requireAdmin,(req,res)=>{
 res.json(data.users.map(safeUser));
});


app.post("/api/admin/users/:id/password",requireAdmin,async(req,res)=>{
 try{
  const u=data.users.find(x=>x.id===req.params.id);

  if(!u){
   return res.status(404).json({
    error:"Không tìm thấy user"
   });
  }

  const next=String(req.body.next||"");

  if(next.length<6){
   return res.status(400).json({
    error:"Mật khẩu mới tối thiểu 6 ký tự"
   });
  }

  u.passwordHash=await bcrypt.hash(next,12);

  save();

  res.json({
   ok:true
  });

 }catch(e){
  console.error("ADMIN RESET PASSWORD ERROR:",e);

  res.status(500).json({
   error:"Không đặt lại được mật khẩu"
  });
 }
});

app.post("/api/admin/users/:id/verify",requireAdmin,(req,res)=>{
 const u=data.users.find(x=>x.id===req.params.id);

 if(!u)return res.status(404).json({error:"Không tìm thấy user"});

 u.verified=!u.verified;
 save();

 res.json({ok:true,verified:u.verified});
});

app.post("/api/admin/users/:id/coins",requireAdmin,(req,res)=>{
 const u=data.users.find(x=>x.id===req.params.id);

 if(!u){
  return res.status(404).json({
   error:"Không tìm thấy user"
  });
 }

 const amount=Number(req.body.amount);

 if(!Number.isInteger(amount)||amount<=0){
  return res.status(400).json({
   error:"Số Coin phải là số nguyên lớn hơn 0"
  });
 }

 u.coins=Number(u.coins||0)+amount;

 if(!Array.isArray(data.walletTransactions)){
  data.walletTransactions=[];
 }

 data.walletTransactions.push({
  id:crypto.randomUUID(),
  userId:u.id,
  type:"admin_add",
  amount,
  balance:u.coins,
  note:"Admin cộng Coin",
  createdAt:new Date().toISOString()
 });

 save();

 res.json({
  ok:true,
  userId:u.id,
  coins:u.coins,
  added:amount
 });
});
app.post("/api/admin/users/:id/ban",requireAdmin,(req,res)=>{
 const u=data.users.find(x=>x.id===req.params.id);

 if(!u)return res.status(404).json({error:"Không tìm thấy user"});

 u.banned=!u.banned;
 save();

 res.json({ok:true,banned:u.banned});
});


/* ================= ADMIN VOUCHERS ================= */

app.get("/api/admin/vouchers",requireAdmin,(req,res)=>{
 if(!Array.isArray(data.vouchers)){
  data.vouchers=[];
 }

 res.json({
  vouchers:data.vouchers
   .slice()
   .sort((a,b)=>
    new Date(b.createdAt)-new Date(a.createdAt)
   )
 });
});


app.post("/api/admin/vouchers",requireAdmin,(req,res)=>{
 if(!Array.isArray(data.vouchers)){
  data.vouchers=[];
 }

 const code=String(req.body.code||"")
  .trim()
  .toUpperCase();

 const percent=Number(req.body.percent);
 const maxUses=Math.floor(Number(req.body.maxUses)||0);

 if(!code){
  return res.status(400).json({
   error:"Mã voucher không được trống"
  });
 }

 if(!/^[A-Z0-9_-]{3,30}$/.test(code)){
  return res.status(400).json({
   error:"Mã voucher chỉ gồm A-Z, số, _ hoặc -"
  });
 }

 if(!Number.isFinite(percent)||percent<=0||percent>100){
  return res.status(400).json({
   error:"Phần trăm giảm phải từ 1 đến 100"
  });
 }

 if(maxUses<0){
  return res.status(400).json({
   error:"Số lượt sử dụng không hợp lệ"
  });
 }

 const exists=data.vouchers.some(v=>
  String(v.code||"").toUpperCase()===code
 );

 if(exists){
  return res.status(409).json({
   error:"Mã voucher đã tồn tại"
  });
 }

 const voucher={
  id:id(),
  code,
  percent,
  maxUses,
  used:0,
  active:true,
  createdAt:now()
 };

 data.vouchers.push(voucher);

 save();

 res.json({
  ok:true,
  voucher
 });
});


app.post("/api/admin/vouchers/:id/toggle",requireAdmin,(req,res)=>{
 const v=data.vouchers.find(x=>x.id===req.params.id);

 if(!v){
  return res.status(404).json({
   error:"Không tìm thấy voucher"
  });
 }

 v.active=v.active===false;

 save();

 res.json({
  ok:true,
  active:v.active
 });
});


app.delete("/api/admin/vouchers/:id",requireAdmin,(req,res)=>{
 const i=data.vouchers.findIndex(
  x=>x.id===req.params.id
 );

 if(i<0){
  return res.status(404).json({
   error:"Không tìm thấy voucher"
  });
 }

 data.vouchers.splice(i,1);

 save();

 res.json({
  ok:true
 });
});

app.get("/api/admin/sellers",requireAdmin,(req,res)=>{
 res.json(
  data.users
   .filter(x=>x.sellerStatus&&x.sellerStatus!=="none")
   .map(safeUser)
 );
});

app.post("/api/admin/sellers/:id/:action",requireAdmin,(req,res)=>{
 const u=data.users.find(x=>x.id===req.params.id);

 if(!u)return res.status(404).json({error:"Không tìm thấy"});
 
 if(req.params.action==="approve"){
  u.role="seller";
  u.sellerStatus="approved";
 }else if(req.params.action==="reject"){
  u.role="user";
  u.sellerStatus="rejected";
 }else if(req.params.action==="verify"){
  u.verified=!u.verified;
 }else{
  return res.status(400).json({error:"Action không hợp lệ"});
 }

 save();

 res.json({ok:true});
});

app.get("/api/admin/products",requireAdmin,(req,res)=>{
 res.json(data.products.map(safeProduct));
});

app.post("/api/admin/products/:id/toggle",requireAdmin,(req,res)=>{
 const p=data.products.find(x=>x.id===req.params.id);

 if(!p)return res.status(404).json({error:"Không tìm thấy"});

 p.hidden=!p.hidden;
 save();

 res.json({ok:true});
});

app.delete("/api/admin/products/:id",requireAdmin,(req,res)=>{
 const i=data.products.findIndex(x=>x.id===req.params.id);

 if(i<0)return res.status(404).json({error:"Không tìm thấy"});

 const p=data.products[i];

 try{
  fs.unlinkSync(path.join(PRODUCTS,p.storedFilename));
 }catch{}

 for(const x of p.images||[]){
  try{
   fs.unlinkSync(path.join(IMAGES,path.basename(x)));
  }catch{}
 }

 if(p.video){
  try{
   fs.unlinkSync(path.join(VIDEOS,path.basename(p.video)));
  }catch{}
 }

 data.products.splice(i,1);
 save();

 res.json({ok:true});
});

app.get("/api/admin/orders",requireAdmin,(req,res)=>{
 res.json(
  data.orders.map(o=>({
   ...o,
   buyer:safeUser(data.users.find(u=>u.id===o.buyerId)),
   product:safeProduct(data.products.find(p=>p.id===o.productId))
  }))
 );
});


app.post("/api/admin/orders/:id/pay",requireAdmin,(req,res)=>{
 const o=data.orders.find(x=>x.id===req.params.id);
 if(!o)return res.status(404).json({error:"Không tìm thấy đơn hàng"});
 if(o.status==="paid")return res.json({ok:true,already:true,order:o});
 if(o.status!=="pending")return res.status(400).json({error:"Đơn hàng không ở trạng thái chờ thanh toán"});
 const p=data.products.find(x=>x.id===o.productId);
 const buyer=data.users.find(x=>x.id===o.buyerId);
 const seller=p?data.users.find(x=>x.id===p.sellerId):null;
 if(!p||!buyer)return res.status(404).json({error:"Dữ liệu đơn hàng không đầy đủ"});
 const amount=Math.max(0,Number(o.amount)||0);
 if(amount>0){
  if(Number(buyer.coins||0)<amount)return res.status(400).json({error:"Khách không đủ Coin để thanh toán đơn này"});
  debitCoins(buyer.id,amount,"ORDER:"+o.id,"Mua "+p.name,{orderId:o.id,productId:p.id});
 }
 const commissionPercent=Math.min(100,Math.max(0,Number(data.settings.commission??10)));
 const commission=Math.floor(amount*commissionPercent/100);
 const sellerAmount=Math.max(0,amount-commission);
 if(seller&&seller.id!==buyer.id&&sellerAmount>0){
  seller.coins=Number(seller.coins||0)+sellerAmount;
  walletTransaction(seller.id,"credit",sellerAmount,"SALE:"+o.id,"Doanh thu bán "+p.name,{orderId:o.id,commission});
 }
 o.status="paid";
 o.paidAt=now();
 o.commission=commission;
 o.commissionPercent=commissionPercent;
 o.sellerAmount=sellerAmount;
 if(p.category==="Tài khoản"){
  p.sold=true;p.soldAt=now();p.soldTo=buyer.id;p.hidden=true;
 }
 save();
 addOrderBuyerNotification(o);
 if(seller&&seller.id!==buyer.id)notify(seller.id,"Có đơn hàng mới","Bạn vừa bán "+p.name);
 save();
 res.json({ok:true,order:o});
});

app.post("/api/admin/settings",requireAdmin,(req,res)=>{
 if(req.body.siteName!=null){
  data.settings.siteName=String(req.body.siteName);
 }

 if(req.body.commission!=null){
  const n=Number(req.body.commission);
  const c=Number.isFinite(n)?Math.min(100,Math.max(0,n)):Number(data.settings.commission??10);
  data.settings.commission=c;
 }

 if(req.body.cardOtherDiscountPercent!=null){
  const n=Number(req.body.cardOtherDiscountPercent);
  const c=Number.isFinite(n)?Math.min(10,Math.max(5,n)):10;
  data.settings.cardOtherDiscountPercent=c;
 }

 if(req.body.withdrawFeePercent!=null){
  const n=Number(req.body.withdrawFeePercent);
  const c=Number.isFinite(n)?Math.min(100,Math.max(0,n)):Number(data.settings.withdrawFeePercent??10);
  data.settings.withdrawFeePercent=c;
 }

 if(req.body.coinToVnd!=null){
  const n=Number(req.body.coinToVnd);
  const c=Number.isFinite(n)&&n>0?n:Number(data.settings.coinToVnd??1);
  data.settings.coinToVnd=c;
 }

 if(req.body.maxWithdrawals7d!=null){
  const n=Number(req.body.maxWithdrawals7d);
  const c=Number.isFinite(n)?Math.max(1,Math.floor(n)):Number(data.settings.maxWithdrawals7d??2);
  data.settings.maxWithdrawals7d=c;
 }

 if(req.body.bankAccounts!=null){
  try{
   const accounts=
    typeof req.body.bankAccounts==="string"
     ? JSON.parse(req.body.bankAccounts)
     : req.body.bankAccounts;

   if(!Array.isArray(accounts)){
    throw new Error("bankAccounts phải là mảng");
   }

   data.settings.bankAccounts=accounts
    .map(x=>({
     bank:String(x.bank||""),
     account:String(x.account||""),
     owner:String(x.owner||""),
     bin:String(x.bin||"")
    }))
    .filter(x=>x.bank&&x.account&&x.owner);

  }catch(e){
   return res.status(400).json({
    error:"bankAccounts không hợp lệ"
   });
  }
 }

 for(const k of [
  "bankName",
  "bankAccount",
  "bankOwner",
  "paymentNote"
 ]){
  if(req.body[k]!=null){
   data.settings[k]=String(req.body[k]);
  }
 }

 save();

 res.json({ok:true,settings:data.settings});
});

/* Admin download */

app.get("/api/admin/download/:id",requireAdmin,(req,res)=>{
 const p=data.products.find(x=>x.id===req.params.id);

 if(!p)return res.status(404).send("Không tồn tại");

 const file=path.join(PRODUCTS,p.storedFilename);

 if(!fs.existsSync(file)){
  return res.status(404).send("File không còn");
 }

 res.download(file,p.originalFilename);
});

/* Admin chat overview */

app.get("/api/admin/chats",requireAdmin,(req,res)=>{
 res.json(
  data.messages.map(m=>({
   ...m,
   from:safeUser(data.users.find(u=>u.id===m.fromId)),
   to:safeUser(data.users.find(u=>u.id===m.toId))
  }))
 );
});

/* ================= ERRORS / SPA ================= */

app.use((err,req,res,next)=>{
 if(err&&err.code==="LIMIT_UNEXPECTED_FILE"){
  return res.status(400).json({error:"Bạn đã gửi quá số lượng file cho phép. File sản phẩm tối đa 100 file."});
 }
 if(err&&err.code==="LIMIT_FILE_SIZE"){
  return res.status(413).json({error:"File quá lớn. Mỗi file tối đa 1 GB."});
 }
 console.error(err);
 if(req.path.startsWith("/api/")||req.path.startsWith("/download/")||req.path.startsWith("/media/")){
  return res.status(500).json({error:"Internal Server Error"});
 }
 next(err);
});

app.use((req,res,next)=>{
 if(req.path.startsWith("/api/"))return res.status(404).json({error:"API không tồn tại"});
 if(req.path.startsWith("/download/")||req.path.startsWith("/media/"))return res.status(404).end();
 next();
});

app.get("/admin",(req,res)=>{
 res.sendFile(path.join(ROOT,"public","index.html"));
});

app.use((req,res)=>{ res.sendFile(path.join(ROOT,"public","index.html")); });

app.listen(PORT,()=>{
 console.log("");
 console.log("======================================");
 console.log(" FileMarket V2");
 console.log(" http://localhost:"+PORT);
 console.log(" Admin: http://localhost:"+PORT+"/admin");
 console.log("======================================");
 console.log("");
});





















