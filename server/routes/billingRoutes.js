const express = require('express');
const { randomBytes } = require('crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const verifyBusinessOwner = require('../middleware/verifyBusinessOwner');
const verifyPOSAccess=require('../middleware/verifyPOSAccess');

const router = express.Router();
router.use(verifyPOSAccess);

function sanitizeSale(s,employee=true){if(!employee)return s;const {costOfGoods,grossProfit,...safe}=s;return {...safe,items:Array.isArray(s.items)?s.items.map(({unitCost,...line})=>line):[]};}
const roundMoney = n => Math.round((n + Number.EPSILON) * 100) / 100;
const validMoney = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000000000;
const fail = (status, message) => Object.assign(new Error(message), { status });

router.post('/checkout', async (req, res) => {
  try {
    const { items, discount = 0, received, customerName = '', customerPhone = '', requestId } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 30) throw fail(400, 'Select 1 to 30 products.');
    if (!validMoney(discount) || !validMoney(received)) throw fail(400, 'Invalid discount or cash received.');
    if (typeof customerName !== 'string' || customerName.length > 120 || typeof customerPhone !== 'string' || customerPhone.length > 40) throw fail(400, 'Invalid customer details.');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(requestId)) throw fail(400, 'Invalid checkout request ID.');

    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item.productId !== 'string' || !/^[a-zA-Z0-9]{10,40}$/.test(item.productId) ||
          !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000 || seen.has(item.productId)) {
        throw fail(400, 'Invalid or duplicate cart item.');
      }
      seen.add(item.productId);
    }

    const db = getFirestore();
    const businessRef = db.collection('businesses').doc(req.owner.businessId);
    const saleRef = businessRef.collection('sales').doc(requestId);
    const productRefs = items.map(item => businessRef.collection('products').doc(item.productId));

    const result = await db.runTransaction(async tx => {
      const oldSale = await tx.get(saleRef);
      if (oldSale.exists) {
        const old = oldSale.data();
        if (old.createdBy !== req.owner.uid) throw fail(409, 'Checkout ID already used.');
        return { id: saleRef.id, ...old, repeated: true };
      }

      // All transaction reads occur before any writes.
      const snapshots = await Promise.all(productRefs.map(ref => tx.get(ref)));
      const saleItems = [];
      let subtotalCents = 0;

      snapshots.forEach((snap, index) => {
        const requested = items[index];
        if (!snap.exists) throw fail(409, 'A product was removed. Refresh inventory.');
        const product = snap.data();
        const stock = Number(product.stock);
        const price = Number(product.sellingPrice);
        if (!Number.isSafeInteger(stock) || stock < requested.quantity) {
          throw fail(409, `Insufficient stock for ${product.name || requested.productId}.`);
        }
        if (!validMoney(price)) throw fail(409, `Invalid price for ${product.name || requested.productId}.`);
        const priceCents = Math.round(price * 100);
        subtotalCents += priceCents * requested.quantity;
        saleItems.push({
          productId: snap.id,
          name: String(product.name || ''),
          sku: String(product.sku || ''),
          quantity: requested.quantity,
          unitPrice: priceCents / 100,
          unitCost: validMoney(Number(product.purchasePrice)) ? Number(product.purchasePrice) : null,
          lineTotal: (priceCents * requested.quantity) / 100
        });
      });

      const subtotal = subtotalCents / 100;
      const discountCents = Math.round(discount * 100);
      const receivedCents = Math.round(received * 100);
      if (discountCents > subtotalCents) throw fail(400, 'Discount cannot exceed subtotal.');
      const totalCents = subtotalCents - discountCents;
      if (receivedCents < totalCents) throw fail(400, 'Cash received is less than total.');
      const total = totalCents / 100;
      const costOfGoods = roundMoney(saleItems.reduce((sum,item)=>sum + (item.unitCost ?? 0)*item.quantity,0));
      const costComplete = saleItems.every(item => item.unitCost !== null);
      const sale = {
        receiptToken: randomBytes(24).toString('hex'),
        costOfGoods: costComplete ? costOfGoods : null,
        grossProfit: costComplete ? roundMoney(total - costOfGoods) : null,
        receiptNumber: `POS-${requestId.slice(0, 8).toUpperCase()}`,
        items: saleItems,
        subtotal,
        discount: discountCents / 100,
        total,
        received: receivedCents / 100,
        change: (receivedCents - totalCents) / 100,
        paymentMethod: 'cash',
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        createdBy: req.owner.uid,
        createdAt: FieldValue.serverTimestamp(),
        status: 'completed'
      };

      productRefs.forEach((ref, index) => {
        tx.update(ref, {
          stock: Number(snapshots[index].data().stock) - items[index].quantity,
          updatedAt: FieldValue.serverTimestamp()
        });
      });
      tx.create(saleRef, sale);
      return { id: saleRef.id, ...sale, repeated: false };
    });

    res.json({ success: true, sale: req.owner.role==='employee'?sanitizeSale(result):result });
  } catch (error) {
    console.error('POS checkout:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Checkout failed. Please retry with the same cart.' });
  }
});

// Owner-only receipt history, date-filtered on the server and paginated.
router.get('/sales', async (req,res) => {
  try {
    const db=getFirestore();
    const {from,to,cursor}=req.query;
    const {Timestamp}=require('firebase-admin/firestore');
    let query=db.collection('businesses').doc(req.owner.businessId).collection('sales').orderBy('createdAt','desc');
    if(from){const d=new Date(from);if(!Number.isFinite(d.getTime()))throw fail(400,'Invalid from date.');query=query.where('createdAt','>=',Timestamp.fromDate(d));}
    if(to){const d=new Date(to);if(!Number.isFinite(d.getTime()))throw fail(400,'Invalid to date.');query=query.where('createdAt','<=',Timestamp.fromDate(d));}
    if(cursor){const doc=await db.collection('businesses').doc(req.owner.businessId).collection('sales').doc(String(cursor)).get();if(!doc.exists)throw fail(400,'Invalid page cursor.');query=query.startAfter(doc);}
    const snap=await query.limit(101).get();
    const page=snap.docs.slice(0,100);
    res.json({success:true,sales:page.map(d=>sanitizeSale({id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate?.()?.toISOString()||null},req.owner.role==='employee')),nextCursor:snap.docs.length>100?page[page.length-1].id:null});
  }catch(err){console.error('Sales list:',err);res.status(err.status||500).json({success:false,message:err.status?err.message:'Unable to load sales.'});}
});

// Older sales created before receipt QR support get a token on first viewing.
router.post('/receipt-link/:saleId',async(req,res)=>{
  try{
    const ref=getFirestore().collection('businesses').doc(req.owner.businessId).collection('sales').doc(req.params.saleId);
    const token=await getFirestore().runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists)throw fail(404,'Sale not found.');
      if(snap.data().receiptToken)return snap.data().receiptToken;
      const value=randomBytes(24).toString('hex');tx.update(ref,{receiptToken:value});return value;
    });
    res.json({success:true,receiptToken:token});
  }catch(err){res.status(err.status||500).json({success:false,message:err.status?err.message:'Unable to create receipt link.'});}
});

router.get('/overview',verifyBusinessOwner,async(req,res)=>{
  try{
    const base=getFirestore().collection('businesses').doc(req.owner.businessId);
    const [products,sales]=await Promise.all([base.collection('products').get(),base.collection('sales').get()]);
    const completed=sales.docs.map(d=>d.data()).filter(s=>s.status==='completed');
    const revenue=roundMoney(completed.reduce((n,s)=>n+Number(s.total||0),0));
    const knownCosts=completed.filter(s=>Number.isFinite(s.costOfGoods));
    const costOfGoods=roundMoney(knownCosts.reduce((n,s)=>n+s.costOfGoods,0));
    const grossProfit=roundMoney(knownCosts.reduce((n,s)=>n+Number(s.grossProfit||0),0));
    const lowStock=products.docs.filter(d=>{const p=d.data();return Number(p.stock)>0 && Number(p.stock)<=Number(p.lowStockThreshold||0)}).length;
    res.json({success:true,stats:{revenue,totalSales:completed.length,totalProducts:products.size,lowStock,outOfStock:products.docs.filter(d=>Number(d.data().stock||0)<=0).length,costOfGoods,grossProfit,profitSales:knownCosts.length,digitalReceipts:completed.filter(s=>!!s.receiptToken).length,paperSheetsAvoidedEstimate:completed.length}});
  }catch(err){console.error('Overview:',err);res.status(500).json({success:false,message:'Unable to load overview.'});}
});

module.exports = router;
