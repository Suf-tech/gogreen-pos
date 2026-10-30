const express=require('express');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const verifyOwner=require('../middleware/verifyPOSAccess');
const router=express.Router();router.use(verifyOwner);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const send=(res,e)=>res.status(e.code||500).json({success:false,message:e.code?e.message:'Operation failed.'});
router.get('/sales/:id',async(req,res)=>{try{const sales=getFirestore().collection('businesses').doc(req.owner.businessId).collection('sales');const input=String(req.params.id||'').trim();if(!/^[a-zA-Z0-9_-]{3,100}$/.test(input))throw fail(400,'Invalid receipt or sale ID.');let s=await sales.doc(input).get();if(!s.exists){const matches=await sales.where('receiptNumber','==',input.toUpperCase()).limit(2).get();if(matches.empty)throw fail(404,'Sale not found. Enter the POS-... receipt number shown on your receipt.');if(matches.size>1)throw fail(409,'Multiple sales use this receipt number. Contact support.');s=matches.docs[0];}const d=s.data();res.json({success:true,sale:{id:s.id,receiptNumber:d.receiptNumber,items:d.items,total:d.total,status:d.status}});}catch(e){send(res,e)}});
router.get('/history',async(req,res)=>{try{const snap=await getFirestore().collection('businesses').doc(req.owner.businessId).collection('returns').orderBy('createdAt','desc').limit(100).get();res.json({success:true,returns:snap.docs.map(d=>({id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate?.()?.toISOString()||null}))});}catch(e){send(res,e)}});
router.post('/',async(req,res)=>{try{
 const {saleId,items,reason,refundMethod='cash',requestId}=req.body||{};
 if(typeof saleId!=='string'||!saleId||saleId.includes('/'))throw fail(400,'Invalid sale ID.');
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,90}$/.test(requestId))throw fail(400,'Invalid request ID.');
 if(typeof reason!=='string'||reason.trim().length<3||reason.length>300)throw fail(400,'Reason required.');
 if(!['cash','bank_transfer','store_credit'].includes(refundMethod))throw fail(400,'Invalid refund method.');
 if(!Array.isArray(items)||!items.length||items.length>30||items.some(x=>!x||typeof x.productId!=='string'||!Number.isSafeInteger(x.quantity)||x.quantity<1))throw fail(400,'Invalid returned quantities.');
 if(new Set(items.map(x=>x.productId)).size!==items.length)throw fail(400,'Duplicate items.');
 const db=getFirestore(),b=db.collection('businesses').doc(req.owner.businessId),saleRef=b.collection('sales').doc(saleId),returnRef=b.collection('returns').doc(requestId);
 let result;
 await db.runTransaction(async tx=>{
  const [prior,saleSnap]=await Promise.all([tx.get(returnRef),tx.get(saleRef)]);
  if(prior.exists){if(prior.data().saleId!==saleId)throw fail(409,'Request ID already used.');result={id:returnRef.id,...prior.data(),repeated:true};return;}
  if(!saleSnap.exists)throw fail(404,'Sale not found.');
  const sale=saleSnap.data();if(sale.status!=='completed'&&sale.status!=='partially_refunded')throw fail(409,'Sale cannot be refunded.');
  const original=Array.isArray(sale.items)?sale.items:[];
  const previous=sale.returnedQuantities||{};const updated={...previous};let cents=0;const lines=[];
  for(const it of items){const line=original.find(x=>x.productId===it.productId);if(!line)throw fail(400,'Product not in original sale.');const used=Number(previous[it.productId]||0);if(used+it.quantity>line.quantity)throw fail(409,'Return quantity exceeds sold quantity.');updated[it.productId]=used+it.quantity;const unit=Number(line.unitPrice);if(!Number.isFinite(unit)||unit<0)throw fail(409,'Invalid original price.');cents+=Math.round(unit*100)*it.quantity;lines.push({productId:it.productId,name:line.name,quantity:it.quantity,unitPrice:unit});}
  // Prorate original sale-level discount across returned merchandise; avoid over-refund.
  const originalSubtotal=Number(sale.subtotal||0),originalTotal=Number(sale.total||0);
  const gross=cents/100;const refundable=originalSubtotal>0?Math.round(gross*originalTotal/originalSubtotal*100)/100:gross;
  const previouslyRefunded=Number(sale.refundedAmount||0);const amount=Math.min(refundable,Math.max(0,originalTotal-previouslyRefunded));
  if(amount<=0)throw fail(409,'Nothing refundable remains.');
  const refs=items.map(it=>b.collection('products').doc(it.productId));const productSnaps=await Promise.all(refs.map(x=>tx.get(x)));
  const allReturned=original.every(x=>Number(updated[x.productId]||0)>=Number(x.quantity));
  for(let i=0;i<refs.length;i++){if(productSnaps[i].exists)tx.update(refs[i],{stock:FieldValue.increment(items[i].quantity),updatedAt:FieldValue.serverTimestamp()});}
  tx.update(saleRef,{returnedQuantities:updated,refundedAmount:Math.round((previouslyRefunded+amount)*100)/100,status:allReturned?'refunded':'partially_refunded',updatedAt:FieldValue.serverTimestamp()});
  const entry={saleId,receiptNumber:sale.receiptNumber||saleId,items:lines,reason:reason.trim(),refundMethod,amount,status:'recorded',createdBy:req.owner.uid,createdAt:FieldValue.serverTimestamp()};tx.create(returnRef,entry);result={id:returnRef.id,...entry,repeated:false};
 });res.status(201).json({success:true,return:result});
 }catch(e){console.error('Return',e);send(res,e)}});
module.exports=router;
