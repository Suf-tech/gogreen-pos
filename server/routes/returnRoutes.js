
const express = require('express');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const verifyBusinessOwner = require('../middleware/verifyBusinessOwner');

const router = express.Router();
router.use(verifyBusinessOwner);

const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fail = (status, message) =>
  Object.assign(new Error(message), { status });

function base(req) {
  return getFirestore().collection('businesses').doc(req.owner.businessId);
}

function publicSale(id, sale) {
  return {
    id,
    receiptNumber: sale.receiptNumber,
    createdAt: sale.createdAt?.toDate?.()?.toISOString() || null,
    customerName: sale.customerName || '',
    items: (sale.items || []).map(item => ({
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      returnedQuantity: item.returnedQuantity || 0
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    refundedAmount: sale.refundedAmount || 0,
    status: sale.status
  };
}

// Verify an original receipt before accepting a return.
router.get('/verify', async (req, res) => {
  try {
    const number = String(req.query.receiptNumber || '').trim();

    if (!/^POS-[A-Z0-9]{8}$/.test(number)) {
      throw fail(400, 'Enter a valid POS receipt number.');
    }

    const snapshot = await base(req)
      .collection('sales')
      .where('receiptNumber', '==', number)
      .limit(2)
      .get();

    if (snapshot.empty) {
      throw fail(404, 'No matching sale found for this business.');
    }

    if (snapshot.size !== 1) {
      throw fail(409, 'Duplicate receipt numbers found. Contact admin.');
    }

    const doc = snapshot.docs[0];
    const sale = doc.data();

    if (!['completed', 'partially_refunded', 'refunded'].includes(sale.status)) {
      throw fail(409, 'This sale is not eligible for return.');
    }

    res.json({
      success: true,
      sale: publicSale(doc.id, sale)
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.status ? err.message : 'Unable to verify receipt.'
    });
  }
});

// Process a quantity-based return and restore inventory.
router.post('/refund', async (req, res) => {
  try {
    const { saleId, items, reason = '', requestId } = req.body || {};

    if (typeof saleId !== 'string' ||
        !/^[a-zA-Z0-9_-]{12,120}$/.test(saleId)) {
      throw fail(400, 'Invalid sale ID.');
    }

    if (typeof requestId !== 'string' ||
        !/^[a-zA-Z0-9_-]{12,100}$/.test(requestId)) {
      throw fail(400, 'Invalid refund request ID.');
    }

    if (!Array.isArray(items) || !items.length || items.length > 30) {
      throw fail(400, 'Select products to return.');
    }

    if (typeof reason !== 'string' || reason.length > 500) {
      throw fail(400, 'Invalid return reason.');
    }

    const quantities = new Map();

    for (const item of items) {
      if (!item || typeof item.productId !== 'string' ||
          !/^[a-zA-Z0-9]{10,40}$/.test(item.productId) ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1 ||
          quantities.has(item.productId)) {
        throw fail(400, 'Invalid or duplicate return item.');
      }
      quantities.set(item.productId, item.quantity);
    }

    const db = getFirestore();
    const business = base(req);
    const saleRef = business.collection('sales').doc(saleId);
    const refundRef = business.collection('refunds').doc(requestId);

    const result = await db.runTransaction(async tx => {
      const existingRefund = await tx.get(refundRef);

      if (existingRefund.exists) {
        const old = existingRefund.data();
        if (old.createdBy !== req.owner.uid || old.saleId !== saleId) {
          throw fail(409, 'Refund request ID already used.');
        }
        return { id: refundRef.id, ...old, repeated: true };
      }

      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists) throw fail(404, 'Sale not found.');

      const sale = saleSnap.data();

      if (!['completed', 'partially_refunded'].includes(sale.status)) {
        throw fail(409, 'Sale is not eligible for another refund.');
      }

      if (sale.paymentMethod !== 'cash') {
        throw fail(409, 'This route currently supports cash refunds only.');
      }

      const saleItems = Array.isArray(sale.items) ? sale.items : [];
      const selected = [];
      let refundCents = 0;
      let returnedCostCents = 0;
      let costKnown = true;

      const updatedItems = saleItems.map(item => {
        const requested = quantities.get(item.productId) || 0;
        const previouslyReturned = Number(item.returnedQuantity || 0);
        const available = Number(item.quantity) - previouslyReturned;

        if (requested > available) {
          throw fail(409, `Return quantity exceeds available quantity for ${item.name}.`);
        }

        if (requested) {
          const unitPriceCents = Math.round(Number(item.unitPrice) * 100);
          const originalSubtotalCents = Math.round(Number(sale.subtotal) * 100);
          const originalTotalCents = Math.round(Number(sale.total) * 100);

          if (!Number.isSafeInteger(unitPriceCents) ||
              originalSubtotalCents <= 0 ||
              originalTotalCents < 0) {
            throw fail(409, 'Original sale amounts are invalid.');
          }

          // Allocate the original sale discount proportionally.
          const amount = Math.round(
            unitPriceCents * requested *
            originalTotalCents / originalSubtotalCents
          );

          refundCents += amount;

          if (item.unitCost === null ||
              item.unitCost === undefined ||
              !Number.isFinite(Number(item.unitCost))) {
            costKnown = false;
          } else {
            returnedCostCents += Math.round(Number(item.unitCost) * 100) * requested;
          }

          selected.push({
            productId: item.productId,
            name: item.name,
            quantity: requested,
            amount: amount / 100
          });
        }

        return {
          ...item,
          returnedQuantity: previouslyReturned + requested
        };
      });

      if (selected.length !== quantities.size) {
        throw fail(400, 'One or more products do not belong to this sale.');
      }

      const productRefs = selected.map(item =>
        business.collection('products').doc(item.productId)
      );

      const productSnaps = await Promise.all(
        productRefs.map(ref => tx.get(ref))
      );

      productSnaps.forEach((snap, index) => {
        if (!snap.exists) {
          throw fail(409, `Product ${selected[index].name} no longer exists. Manual stock reconciliation required.`);
        }
        if (!Number.isSafeInteger(Number(snap.data().stock))) {
          throw fail(409, 'Product stock is invalid.');
        }
      });

      const oldRefundCents = Math.round(Number(sale.refundedAmount || 0) * 100);
      const totalCents = Math.round(Number(sale.total) * 100);

      // Guard against rounding differences in partial refunds.
      if (oldRefundCents + refundCents > totalCents) {
        refundCents = totalCents - oldRefundCents;
      }

      if (refundCents < 0) {
        throw fail(409, 'Refund exceeds original payment.');
      }

      const allReturned = updatedItems.every(item =>
        Number(item.returnedQuantity || 0) === Number(item.quantity)
      );

      const refundedAmount = (oldRefundCents + refundCents) / 100;
      const refund = {
        saleId,
        receiptNumber: sale.receiptNumber,
        items: selected,
        amount: refundCents / 100,
        returnedCost: costKnown ? returnedCostCents / 100 : null,
        reason: reason.trim(),
        createdBy: req.owner.uid,
        createdAt: FieldValue.serverTimestamp(),
        status: 'completed',
        paymentMethod: 'cash'
      };

      productRefs.forEach((ref, index) => {
        tx.update(ref, {
          stock: Number(productSnaps[index].data().stock) + selected[index].quantity,
          updatedAt: FieldValue.serverTimestamp()
        });
      });

      tx.update(saleRef, {
        items: updatedItems,
        refundedAmount,
        status: allReturned ? 'refunded' : 'partially_refunded',
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.create(refundRef, refund);

      return { id: refundRef.id, ...refund, repeated: false };
    });

    res.json({ success: true, refund: result });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(err.status || 500).json({
      success: false,
      message: err.status ? err.message : 'Refund failed.'
    });
  }
});

router.get('/history', async (req, res) => {
  try {
    const snapshot = await base(req)
      .collection('refunds')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    res.json({
      success: true,
      refunds: snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null
      }))
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Unable to load refunds.'
    });
  }
});

module.exports = router;
