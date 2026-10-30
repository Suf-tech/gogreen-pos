const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const verifySuperAdmin = require('../middleware/verifySuperAdmin');
const router = express.Router();
router.use(verifySuperAdmin);
const amount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
const round = v => Math.round((v + Number.EPSILON) * 100) / 100;
const dateOf = v => v?.toDate?.() || (typeof v === 'string' ? new Date(v) : null);
router.get('/overview', async (_req, res) => {
  try {
    const db = getFirestore();
    const [businessSnap, paymentsSnap] = await Promise.all([
      db.collection('businesses').get(),
      db.collection('subscriptionPayments').get()
    ]);
    // Only explicitly VERIFIED payments count as actual GoGreen revenue.
    // Expected fields: businessId, amount (PKR), status:'verified', verifiedAt.
    const payments = paymentsSnap.docs.map(d => d.data()).filter(p => p.status === 'verified' && typeof p.businessId === 'string');
    const records = await Promise.all(businessSnap.docs.map(async doc => {
      const b = doc.data();
      const sales = await doc.ref.collection('sales').get();
      const validSales = sales.docs.map(s => s.data()).filter(s => !['voided','cancelled','failed','pending'].includes(s.status));
      const paid = payments.filter(p => p.businessId === doc.id);
      return {
        id: doc.id, name: b.name || 'Unnamed Business', type: b.type || 'Other',
        plan: b.plan || 'Basic', status: b.status || 'disabled',
        receipts: validSales.length,
        subscriptionPayments: paid.length,
        subscriptionRevenue: round(paid.reduce((sum,p) => sum + amount(p.amount), 0)),
        // NO tenant sales totals, purchase costs or profit are returned.
      };
    }));
    const monthly = {};
    for (const p of payments) {
      const d = dateOf(p.verifiedAt);
      if (!d || !Number.isFinite(d.getTime())) continue;
      const key = d.toISOString().slice(0,7);
      if (!monthly[key]) monthly[key] = { month:key, revenue:0, payments:0 };
      monthly[key].revenue = round(monthly[key].revenue + amount(p.amount));
      monthly[key].payments++;
    }
    const totals = {
      totalBusinesses: records.length,
      activeBusinesses: records.filter(b => b.status === 'active').length,
      digitalReceipts: records.reduce((n,b) => n + b.receipts,0),
      subscriptionRevenue: round(records.reduce((n,b) => n + b.subscriptionRevenue,0)),
      verifiedPayments: payments.length,
      // Expenses have not been modeled; net/gross profit must not be invented.
      profitAvailable: false
    };
    res.set('Cache-Control','no-store');
    res.json({ success:true, totals, businesses:records, monthly:Object.values(monthly).sort((a,b)=>a.month.localeCompare(b.month)) });
  } catch (e) {
    console.error('Platform analytics:',e);
    res.status(500).json({success:false,message:'Unable to load platform analytics.'});
  }
});
module.exports = router;
