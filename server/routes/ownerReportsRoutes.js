const express=require('express');const {getFirestore}=require('firebase-admin/firestore');const verifyOwner=require('../middleware/verifyBusinessOwner');const router=express.Router();router.use(verifyOwner);
router.get('/summary',async(req,res)=>{try{const b=getFirestore().collection('businesses').doc(req.owner.businessId);const [sales,returns]=await Promise.all([b.collection('sales').orderBy('createdAt','desc').limit(2000).get(),b.collection('returns').orderBy('createdAt','desc').limit(2000).get()]);let revenue = 0;
let cogs = 0;
let completeCosts = true;
let receipts = 0;
let missingCostSales = 0;const byMonth={};const monthlyReceipts={};const monthlyRefunds={};for(const doc of sales.docs){const x=doc.data();if(!['completed','partially_refunded','refunded'].includes(x.status))continue;const refund=Number(x.refundedAmount||0);const net=Math.max(0,Number(x.total||0)-refund);revenue+=net;if(x.receiptToken)receipts++;if(typeof x.costOfGoods==='number'){const ratio=Number(x.total)>0?net/Number(x.total):0;cogs+=x.costOfGoods*ratio} else {
  completeCosts = false;
  missingCostSales++;
}const dt=x.createdAt?.toDate?.();if(dt){const k=dt.toISOString().slice(0,7);byMonth[k]=(byMonth[k]||0)+net;if(x.receiptToken)monthlyReceipts[k]=(monthlyReceipts[k]||0)+1;}}for(const d of returns.docs){const x=d.data(),dt=x.createdAt?.toDate?.();if(dt){const k=dt.toISOString().slice(0,7);monthlyRefunds[k]=(monthlyRefunds[k]||0)+Number(x.amount||0)}}const refunded=returns.docs.reduce((n,d)=>n+Number(d.data().amount||0),0);res.json({success:true,summary:{netSales:Math.round(revenue*100)/100,estimatedGrossProfit: completeCosts
  ? Math.round((revenue - cogs) * 100) / 100
  : null,

missingCostSales,refunds:Math.round(refunded*100)/100,receiptCount:receipts,estimatedPaperSavedGrams:receipts,estimatedTreesSaved:null,monthlyReceipts,monthlyRefunds,limited:sales.size===2000||returns.size===2000,monthly:Object.entries(byMonth).sort(([a],[b])=>a.localeCompare(b)).map(([month,total])=>({month,total:Math.round(total*100)/100}))}});}catch(e){console.error('Owner reports',e);res.status(500).json({success:false,message:'Unable to load reports.'})}});module.exports=router;
