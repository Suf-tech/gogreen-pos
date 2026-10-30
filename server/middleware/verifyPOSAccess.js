const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
module.exports=async function verifyPOSAccess(req,res,next){
 try{
  const header=req.headers.authorization||'';
  if(!header.startsWith('Bearer '))return res.status(401).json({success:false,message:'Sign in required.'});
  const token=await getAuth().verifyIdToken(header.slice(7),true);
  if(!token.email_verified)return res.status(403).json({success:false,message:'Verify your email first.'});
  const db=getFirestore();const u=await db.collection('users').doc(token.uid).get();
  if(!u.exists)return res.status(403).json({success:false,message:'Account not linked.'});
  const profile=u.data();if(!['business_owner','employee'].includes(profile.role)||!profile.businessId)return res.status(403).json({success:false,message:'POS access denied.'});
  const b=await db.collection('businesses').doc(profile.businessId).get();
  if(!b.exists||b.data().status!=='active')return res.status(403).json({success:false,message:'Business inactive.'});
  if(profile.role==='business_owner'){
   if(b.data().ownerUid!==token.uid)return res.status(403).json({success:false,message:'Owner mismatch.'});
  }else{
   if(!profile.employeeId)return res.status(403).json({success:false,message:'Employee link missing.'});
   const e=await b.ref.collection('employees').doc(profile.employeeId).get();
   if(!e.exists||e.data().active!==true||e.data().uid!==token.uid||String(e.data().email).toLowerCase()!==String(token.email).toLowerCase())return res.status(403).json({success:false,message:'Employee access revoked.'});
  }
  req.owner={uid:token.uid,email:token.email,businessId:profile.businessId,businessName:b.data().name,businessPlan:b.data().plan,role:profile.role};next();
 }catch(e){console.error('POS verification:',e);res.status(401).json({success:false,message:'Invalid session.'});}
};
