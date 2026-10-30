const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const router = express.Router();
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => `Rs. ${Number(n || 0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
router.get('/:businessId/:saleId/:token', async (req,res) => {
  try {
    const {businessId,saleId,token} = req.params;
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(businessId) || !/^[a-zA-Z0-9_-]{12,120}$/.test(saleId) || !/^[a-f0-9]{48}$/.test(token)) return res.status(404).send('Receipt not found');
    const db=getFirestore();
    const business=await db.collection('businesses').doc(businessId).get();
    const snap=await db.collection('businesses').doc(businessId).collection('sales').doc(saleId).get();
    if(!snap.exists || !business.exists || snap.data().receiptToken!==token) return res.status(404).send('Receipt not found');
    const sale=snap.data();
    const rows=(sale.items||[]).map(item=>`<tr><td>${escapeHtml(item.name)} × ${Number(item.quantity)||0}</td><td>${escapeHtml(money(item.lineTotal))}</td></tr>`).join('');
    const when=sale.createdAt?.toDate?.()?.toLocaleString('en-PK',{timeZone:'Asia/Karachi'}) || 'Date unavailable';
    res.set('Cache-Control','no-store');
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Digital Receipt ${escapeHtml(sale.receiptNumber)}</title><style>body{font:15px system-ui;background:#f1f8f3;padding:20px;color:#193b29}.paper{max-width:440px;margin:auto;background:white;border-radius:16px;padding:28px;box-shadow:0 5px 20px #14392220}h1{text-align:center;font-size:24px}p{text-align:center;color:#60736a}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:9px 0;border-bottom:1px solid #e5eee7}td:last-child{text-align:right}.total{font-size:20px;font-weight:800;color:#147b4d}.foot{text-align:center;font-size:12px;color:#668273}@media print{body{background:white;padding:0}.paper{box-shadow:none}}</style></head><body><main class="paper"><h1>${escapeHtml(business.data().name||'GoGreen POS')}</h1><p>DIGITAL SALES RECEIPT<br>${escapeHtml(sale.receiptNumber)}<br>${escapeHtml(when)}</p><table>${rows}<tr><td>Subtotal</td><td>${escapeHtml(money(sale.subtotal))}</td></tr><tr><td>Discount</td><td>${escapeHtml(money(sale.discount))}</td></tr><tr class="total"><td>Total</td><td>${escapeHtml(money(sale.total))}</td></tr><tr><td>Paid (${escapeHtml(sale.paymentMethod||'cash')})</td><td>${escapeHtml(money(sale.received))}</td></tr><tr><td>Change</td><td>${escapeHtml(money(sale.change))}</td></tr></table><p>Thank you for choosing a digital receipt 🌿</p><div class="foot">Powered by GoGreen POS · No paper required</div></main></body></html>`);
  }catch(err){console.error('Public receipt:',err);res.status(500).send('Unable to load receipt');}
});
module.exports=router;
