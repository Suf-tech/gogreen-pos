
const express = require('express');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const verifyBusinessOwner = require('../middleware/verifyBusinessOwner');
const verifyPOSAccess=require('../middleware/verifyPOSAccess');

const router = express.Router();
router.use(verifyPOSAccess);

const DEFAULT_FIELDS = [
  { key: 'name', type: 'text', required: true },
  { key: 'sku', type: 'text', required: true },
  { key: 'barcode', type: 'text', required: false },
  { key: 'category', type: 'text', required: false },
  { key: 'purchasePrice', type: 'number', required: true },
  { key: 'sellingPrice', type: 'number', required: true },
  { key: 'stock', type: 'number', required: true },
  { key: 'lowStockThreshold', type: 'number', required: true },
  { key: 'imageUrl', type: 'image', required: false }
];

const standardKeys = new Set(DEFAULT_FIELDS.map(f => f.key));

function productCollection(req) {
  return getFirestore()
    .collection('businesses')
    .doc(req.owner.businessId)
    .collection('products');
}

function schemaReference(req) {
  return getFirestore()
    .collection('businesses')
    .doc(req.owner.businessId)
    .collection('settings')
    .doc('productSchema');
}

async function getCustomSchema(req) {
  const snapshot = await schemaReference(req).get();

  if (!snapshot.exists) return [];

  const fields = snapshot.data().fields;

  if (!Array.isArray(fields)) return [];

  return fields.filter(
    field =>
      field &&
      typeof field.key === 'string' &&
      /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(field.key) &&
      !standardKeys.has(field.key) &&
      ['text', 'number', 'date', 'boolean', 'image'].includes(field.type)
  );
}

function parseCustomFields(values, schema) {
  if (
    values === null ||
    typeof values !== 'object' ||
    Array.isArray(values)
  ) {
    throw new Error('Invalid custom fields.');
  }

  const allowed = new Set(schema.map(field => field.key));

  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown custom field: ${key}`);
    }
  }

  const result = {};

  for (const field of schema) {
    const raw = values[field.key];

    if (raw === undefined || raw === null || raw === '') {
      if (field.required) {
        throw new Error(`${field.label || field.key} is required.`);
      }
      continue;
    }

    if (field.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        throw new Error(`${field.label || field.key} must be true or false.`);
      }
      result[field.key] = raw;
      continue;
    }

    if (field.type === 'number') {
      if (
        typeof raw === 'boolean' ||
        !Number.isFinite(Number(raw))
      ) {
        throw new Error(`${field.label || field.key} must be a number.`);
      }
      result[field.key] = Number(raw);
      continue;
    }

    if (typeof raw !== 'string' || raw.length > 1000) {
      throw new Error(`${field.label || field.key} is invalid.`);
    }

    if (
      field.type === 'date' &&
      !/^\d{4}-\d{2}-\d{2}$/.test(raw)
    ) {
      throw new Error(`${field.label || field.key} must be a date.`);
    }

    if (field.type === 'image') {
      if (!/^https:\/\//i.test(raw)) {
        throw new Error('Image reference must be an HTTPS URL.');
      }
    }

    result[field.key] = raw;
  }

  return result;
}

async function validateProduct(body, req, existing = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid product data.');
  }

  const name = String(body.name || '').trim();
  const sku = String(body.sku || '').trim();
  const barcode = String(body.barcode || '').trim();
  const category = String(body.category || 'General').trim();

  const purchasePrice = Number(body.purchasePrice);
  const sellingPrice = Number(body.sellingPrice);
  const stock = Number(body.stock);
  const lowStockThreshold = Number(body.lowStockThreshold);

  if (!name || name.length > 150) {
    throw new Error('Enter a valid product name.');
  }

  if (!sku || sku.length > 80) {
    throw new Error('A valid SKU is required.');
  }

  if (barcode.length > 100 || category.length > 100) {
    throw new Error('Invalid barcode or category.');
  }

  if (
    [purchasePrice, sellingPrice].some(
      value => !Number.isFinite(value) || value < 0
    )
  ) {
    throw new Error('Prices must be valid non-negative numbers.');
  }

  if (
    !Number.isSafeInteger(stock) ||
    !Number.isSafeInteger(lowStockThreshold) ||
    stock < 0 ||
    lowStockThreshold < 0
  ) {
    throw new Error('Stock values must be non-negative whole numbers.');
  }

  const schema = await getCustomSchema(req);

  const existingCustom = existing?.customFields || {};
  const incomingCustom = body.customFields || {};

  const mergedCustom = {
    ...existingCustom,
    ...parseCustomFields(incomingCustom, schema)
  };

  // Preserve old values belonging to previously saved fields.
  // Do not silently remove data when the schema changes.
  const imageUrl =
    body.imageUrl === undefined
      ? String(existing?.imageUrl || '')
      : String(body.imageUrl || '').trim();

  if (imageUrl.length > 2000) {
    throw new Error('Image URL is too long.');
  }

  if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
    throw new Error('Product image must use an HTTPS URL.');
  }

  return {
    name,
    sku,
    barcode,
    category: category || 'General',
    purchasePrice,
    sellingPrice,
    stock,
    lowStockThreshold,
    imageUrl,
    customFields: mergedCustom
  };
}

// GET PRODUCTS
router.get('/', async (req, res) => {
  try {
    const snapshot = await productCollection(req)
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      ...(req.owner.role==='employee'?{purchasePrice:undefined,customFields:undefined}: {})
    }));

    return res.json({
      success: true,
      products,
      hasMore: snapshot.size === 500
    });
  } catch (error) {
    console.error('Product list error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load products.'
    });
  }
});

// ADD PRODUCT
router.post('/', verifyBusinessOwner, async (req, res) => {
  try {
    const product = await validateProduct(req.body, req);

    const duplicate = await productCollection(req)
      .where('sku', '==', product.sku)
      .limit(1)
      .get();

    if (!duplicate.empty) {
      return res.status(409).json({
        success: false,
        message: 'This SKU already exists in your inventory.'
      });
    }

    const reference = await productCollection(req).add({
      ...product,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: req.owner.uid
    });

    return res.status(201).json({
      success: true,
      message: 'Product added successfully.',
      productId: reference.id
    });
  } catch (error) {
    console.error('Add product error:', error);
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// EDIT PRODUCT
router.put('/:productId', verifyBusinessOwner, async (req, res) => {
  try {
    const reference = productCollection(req).doc(req.params.productId);
    const existing = await reference.get();

    if (!existing.exists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.'
      });
    }

    const product = await validateProduct(
      req.body,
      req,
      existing.data()
    );

    const duplicate = await productCollection(req)
      .where('sku', '==', product.sku)
      .limit(2)
      .get();

    if (duplicate.docs.some(doc => doc.id !== reference.id)) {
      return res.status(409).json({
        success: false,
        message: 'Another product already uses this SKU.'
      });
    }

    await reference.update({
      ...product,
      updatedAt: FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      message: 'Product updated successfully.'
    });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// DELETE PRODUCT
router.delete('/:productId', verifyBusinessOwner, async (req, res) => {
  try {
    const reference = productCollection(req).doc(req.params.productId);
    const existing = await reference.get();

    if (!existing.exists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.'
      });
    }

    await reference.delete();

    return res.json({
      success: true,
      message: 'Product deleted successfully.'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to delete product.'
    });
  }
});

module.exports = router;
