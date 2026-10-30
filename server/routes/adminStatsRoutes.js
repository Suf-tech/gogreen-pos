
const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const verifySuperAdmin = require('../middleware/verifySuperAdmin');

const router = express.Router();
router.use(verifySuperAdmin);

router.get('/businesses/receipt-counts', async (req, res) => {
  try {
    const db = getFirestore();
    const businesses = await db.collection('businesses').get();

    const counts = {};

    await Promise.all(businesses.docs.map(async business => {
      const sales = await business.ref
        .collection('sales')
        .where('status', 'in', [
          'completed',
          'partially_refunded',
          'refunded'
        ])
        .get();

      counts[business.id] = sales.docs.filter(doc =>
        Boolean(doc.data().receiptToken)
      ).length;
    }));

    res.json({ success: true, counts });
  } catch (error) {
    console.error('Admin receipt counts:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to load receipt counts.'
    });
  }
});

module.exports = router;
