require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const verifySuperAdmin = require('./middleware/verifySuperAdmin');
const { adminRouter, ownerRouter } = require('./routes/ownerRoutes');
const productRoutes = require('./routes/productRoutes');
const productSchemaRoutes = require('./routes/productSchemaRoutes');
const importMappingRoutes = require('./routes/importMappingRoutes');
const billingRoutes = require('./routes/billingRoutes');
const receiptRoutes = require('./routes/receiptRoutes');
const adminAnalyticsRoutes = require('./routes/adminAnalyticsRoutes');
const returnManagementRoutes = require('./routes/returnManagementRoutes');
const ownerReportsRoutes = require('./routes/ownerReportsRoutes');
const { router: subscriptionRoutes, runReminderSweep } = require('./routes/subscriptionRoutes');

const {router:promotionRoutes,promotionSweep}=require('./routes/promotionRoutes');
const employeeRoutes=require('./routes/employeeRoutes');
const employeeAccessRoutes=require('./routes/employeeAccessRoutes');
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '100kb' }));
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

app.get('/api/health', (req, res) => res.json({
  success: true, message: 'GoGreen POS backend is running!', firebase: 'initialized'
}));
app.get('/api/firebase-test', async (req, res) => {
  try {
    await db.collection('businesses').limit(1).get();
    res.json({ success: true, message: 'Firebase Admin SDK connected successfully!' });
  } catch (error) {
    console.error('Firebase connection error:', error);
    res.status(500).json({ success: false, message: 'Firebase connection failed.' });
  }
});
app.get('/api/admin/check', verifySuperAdmin, (req, res) => res.json({
  success: true, message: 'Super Admin verified successfully!', admin: req.adminUser
}));

app.use('/api/admin', adminRouter);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/owner', ownerRouter);
app.use('/api/owner/products', productRoutes);
app.use('/api/owner/product-schema', productSchemaRoutes);
app.use('/api/owner/import-mapping', importMappingRoutes);
app.use('/api/owner/billing', billingRoutes);
app.use('/api/public/receipts', receiptRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/promotions',promotionRoutes);
app.use('/api/owner/employees',employeeRoutes);
app.use('/api/employee',employeeAccessRoutes);
app.use('/api/owner/return-management', returnManagementRoutes);
app.use('/api/owner/reports', ownerReportsRoutes);

// Always register the 404 handler AFTER every API route.
app.use('/api', (req, res) => res.status(404).json({
  success: false, message: 'API endpoint not found.'
}));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`GoGreen POS server running on port ${PORT}`));

// Check in-app reminders every 6 hours while the server is running.
setTimeout(() => runReminderSweep().catch(console.error), 15000);
setInterval(() => runReminderSweep().catch(console.error), 6 * 60 * 60 * 1000);

setTimeout(()=>promotionSweep().catch(console.error),20000);
setInterval(()=>promotionSweep().catch(console.error),6*60*60*1000);
