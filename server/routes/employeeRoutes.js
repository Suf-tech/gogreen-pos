const express = require('express');
const crypto = require('crypto');
const {getFirestore,FieldValue} = require('firebase-admin/firestore');
const verifyOwner = require('../middleware/verifyBusinessOwner');
const router = express.Router(); router.use(verifyOwner);
const db = () => getFirestore();
const emailKey = email => crypto.createHash('sha256').update(email).digest('hex');
const normalize = value => String(value||'').trim().toLowerCase();
const err = (status,message) => Object.assign(new Error(message),{status});
const base = req => db().collection('businesses').doc(req.owner.businessId);
const send = (res,e) => res.status(e.status||500).json({success:false,message:e.status?e.message:'Employee operation failed.'});
async function indexEmployee(req,doc) {
 const e=doc.data(); const email=normalize(e.email); if(!email||e.active!==true)return;
 const idx=db().collection('employeeEmailIndex').doc(emailKey(email));
 await db().runTransaction(async tx=>{
  const old=await tx.get(idx);
  if(old.exists && (old.data().businessId!==req.owner.businessId||old.data().employeeId!==doc.id))throw err(409,'This email is registered for another employee.');
  tx.set(idx,{businessId:req.owner.businessId,employeeId:doc.id,email});
 });
}
router.get('/',async(req,res)=>{try{
 const snap=await base(req).collection('employees').get();
 // Also migrate employees added before email-link authentication.
 for(const doc of snap.docs){if(doc.data().active===true)await indexEmployee(req,doc);}
 res.json({success:true,employees:snap.docs.map(d=>({id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate?.()?.toISOString()||null}))});
}catch(e){send(res,e)}});
router.post('/',async(req,res)=>{try{
 const {name,email}=req.body||{};const normalized=normalize(email);
 if(typeof name!=='string'||name.trim().length<2||name.length>80)throw err(400,'Invalid employee name.');
 if(typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)||normalized.length>200)throw err(400,'Invalid email.');
 const b=await base(req).get();const limits={Basic:2,Standard:5,Premium:15};const snap=await b.ref.collection('employees').get();
 if(snap.docs.filter(d=>d.data().active!==false).length>=(limits[b.data().plan]||2))throw err(409,'Employee limit reached for this plan.');
 if(snap.docs.some(d=>normalize(d.data().email)===normalized))throw err(409,'Employee already exists.');
 const idx=db().collection('employeeEmailIndex').doc(emailKey(normalized));
 const ref=b.ref.collection('employees').doc();
 await db().runTransaction(async tx=>{
  const old=await tx.get(idx);if(old.exists)throw err(409,'Email already registered.');
  tx.create(ref,{name:name.trim(),email:normalized,role:'employee',active:true,uid:null,createdAt:FieldValue.serverTimestamp(),createdBy:req.owner.uid});
  tx.create(idx,{businessId:req.owner.businessId,employeeId:ref.id,email:normalized});
 });
 res.status(201).json({success:true,id:ref.id,message:'Employee added. Ask them to sign in at /employee/login using their email.'});
}catch(e){send(res,e)}});
router.post('/:id/deactivate',async(req,res)=>{try{
 const ref=base(req).collection('employees').doc(req.params.id);const snap=await ref.get();if(!snap.exists)throw err(404,'Employee not found.');
 const idx=db().collection('employeeEmailIndex').doc(emailKey(normalize(snap.data().email)));
 await db().runTransaction(async tx=>{const i=await tx.get(idx);tx.update(ref,{active:false,updatedAt:FieldValue.serverTimestamp()});if(i.exists&&i.data().employeeId===ref.id&&i.data().businessId===req.owner.businessId)tx.delete(idx)});
 if(snap.data().uid)await require('firebase-admin/auth').getAuth().revokeRefreshTokens(snap.data().uid);
 res.json({success:true});
}catch(e){send(res,e)}});
module.exports=router;
