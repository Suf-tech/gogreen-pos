const router=require('express').Router();
const crypto=require('crypto');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const verify=require('../middleware/verifyPOSAccess');
const key=email=>crypto.createHash('sha256').update(email).digest('hex');
router.post('/bootstrap',async(req,res)=>{try{
 const header=req.headers.authorization||'';if(!header.startsWith('Bearer '))return res.status(401).json({success:false,message:'Sign-in required.'});
 const decoded=await getAuth().verifyIdToken(header.slice(7),true);
 const email=String(decoded.email||'').trim().toLowerCase();
 if(!decoded.email_verified||!email)return res.status(403).json({success:false,message:'Email verification required.'});
 const db=getFirestore();const idx=await db.collection('employeeEmailIndex').doc(key(email)).get();
 if(!idx.exists||idx.data().email!==email)return res.status(403).json({success:false,message:'No active employee registration for this email. Ask your owner to open Employees page.'});
 const {businessId,employeeId}=idx.data();const bRef=db.collection('businesses').doc(businessId);const eRef=bRef.collection('employees').doc(employeeId);const uRef=db.collection('users').doc(decoded.uid);
 await db.runTransaction(async tx=>{
  const [b,e,u]=await Promise.all([tx.get(bRef),tx.get(eRef),tx.get(uRef)]);
  if(!b.exists||b.data().status!=='active'||!e.exists||e.data().active!==true||String(e.data().email).toLowerCase()!==email)throw Error('Employee account is inactive.');
  if(e.data().uid&&e.data().uid!==decoded.uid)throw Error('Employee account is already linked to another user. Contact your owner.');
  if(u.exists&&(u.data().role!=='employee'||u.data().businessId!==businessId||u.data().employeeId!==employeeId))throw Error('This Firebase account already belongs to another role.');
  tx.set(uRef,{role:'employee',businessId,employeeId,email,createdAt:u.exists?(u.data().createdAt||FieldValue.serverTimestamp()):FieldValue.serverTimestamp()},{merge:true});
  tx.update(eRef,{uid:decoded.uid,updatedAt:FieldValue.serverTimestamp()});
 });
 res.json({success:true,message:'Employee login ready.'});
}catch(e){console.error('Employee bootstrap:',e);res.status(403).json({success:false,message:e.message||'Unable to activate employee session.'})}});
router.get('/me',verify,(req,res)=>{if(req.owner.role!=='employee')return res.status(403).json({success:false,message:'Employee access only.'});res.json({success:true,role:'employee',businessId:req.owner.businessId,businessName:req.owner.businessName,email:req.owner.email})});
module.exports=router;
