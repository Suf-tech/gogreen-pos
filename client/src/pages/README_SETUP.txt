GoGreen POS — Digital Shift Upgrade

COPY FILES:
client/src/pages/OwnerBilling.jsx
client/src/pages/OwnerBilling.css
client/src/pages/ReceiptCard.jsx
client/src/pages/OwnerReceipts.jsx
client/src/pages/OwnerReceipts.css
client/src/pages/OwnerDashboard.jsx (replace existing)
server/routes/billingRoutes.js (replace existing)
server/routes/receiptRoutes.js (new)

CLIENT INSTALL:
cd D:\Documents\gogreen-pos\client
npm install qrcode

SERVER INDEX.JS:
const receiptRoutes = require('./routes/receiptRoutes');
// Before the 404 handler:
app.use('/api/public/receipts', receiptRoutes);
// Existing app.use('/api/owner/billing', billingRoutes) stays unchanged.

PHONE QR ACCESS:
VITE_PUBLIC_API_URL must be a public HTTPS backend origin for phones outside your computer. Example:
VITE_PUBLIC_API_URL=https://your-real-deployed-api.example
The above is a placeholder, not a working URL.
Until backend deployment, localhost QR links won't work on other phones. On the same Wi-Fi a LAN IP may work if firewall permits, but production needs HTTPS.
Restart Vite after editing .env.

SMS:
Not implemented: no verified free SMS gateway. WhatsApp sharing opens a prefilled message; user must send it manually.

DATA:
Existing sales can receive unique QR tokens when opened in Digital Receipts.
New sales store unitCost, costOfGoods and grossProfit snapshot. Old sales do not have historical cost snapshots and are excluded from profit calculations.
Paper saved assumes one paper slip avoided per completed sale; no validated carbon estimate.
Overview currently reads all sales and products; optimize to aggregated counters when dataset becomes large.
Receipt history loads 100 records at a time with Load More.

SECURITY:
QR link is a bearer link; anyone with the URL can see the receipt's purchased items and totals. Public page intentionally excludes customer phone/name. Do not put sensitive personal details into item names.
