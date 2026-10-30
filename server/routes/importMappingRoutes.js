
const express = require('express');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const verifyBusinessOwner = require('../middleware/verifyBusinessOwner');

const router = express.Router();
router.use(verifyBusinessOwner);

const DEFAULT_FIELDS = [
  { key: 'name', label: 'Product Name', type: 'text', required: true },
  { key: 'sku', label: 'SKU', type: 'text', required: true },
  { key: 'barcode', label: 'Barcode', type: 'text', required: false },
  { key: 'category', label: 'Category', type: 'text', required: false },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'number', required: true },
  { key: 'sellingPrice', label: 'Selling Price', type: 'number', required: true },
  { key: 'stock', label: 'Stock Quantity', type: 'number', required: true },
  { key: 'lowStockThreshold', label: 'Low Stock Alert', type: 'number', required: true },
  { key: 'imageUrl', label: 'Product Image', type: 'image', required: false }
];

const allowedTypes = ['text', 'number', 'date', 'boolean', 'image'];
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;

function getRefs(req) {
  const settings = getFirestore()
    .collection('businesses')
    .doc(req.owner.businessId)
    .collection('settings');

  return {
    mapping: settings.doc('importMapping'),
    schema: settings.doc('productSchema')
  };
}

// Load saved mapping
router.get('/', async (req, res) => {
  try {
    const snap = await getRefs(req).mapping.get();

    return res.json({
      success: true,
      mapping: snap.exists ? snap.data() : null
    });
  } catch (error) {
    console.error('Mapping load:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not load import mapping.'
    });
  }
});

// Save mapping and merge custom fields into schema
router.put('/', async (req, res) => {
  try {
    const { columns, mappings, customFields } = req.body;

    if (
      !Array.isArray(columns) ||
      !Array.isArray(mappings) ||
      !Array.isArray(customFields) ||
      columns.length < 1 ||
      columns.length > 100 ||
      customFields.length > 50 ||
      mappings.length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mapping data or too many columns.'
      });
    }

    if (
      columns.some(c =>
        typeof c !== 'string' ||
        !c.trim() ||
        c.length > 150
      ) ||
      new Set(columns).size !== columns.length
    ) {
      throw new Error('Source columns must be unique and valid.');
    }

    const standardKeys = new Set(DEFAULT_FIELDS.map(f => f.key));
    const customKeys = new Set();
    const validatedCustom = [];

    for (const field of customFields) {
      if (!field || typeof field !== 'object') {
        throw new Error('Invalid custom field.');
      }

      const key = String(field.key || '').trim();
      const label = String(field.label || '').trim();
      const type = String(field.type || '').trim();

      if (
        !keyPattern.test(key) ||
        standardKeys.has(key) ||
        customKeys.has(key) ||
        !label ||
        label.length > 100 ||
        !allowedTypes.includes(type)
      ) {
        throw new Error(`Invalid custom field: ${key}`);
      }

      customKeys.add(key);
      validatedCustom.push({
        key,
        label,
        type,
        required: false
      });
    }

    const sourceSet = new Set(columns);
    const targetSet = new Set([...standardKeys, ...customKeys]);
    const usedSources = new Set();
    const usedTargets = new Set();
    const validatedMappings = [];

    for (const item of mappings) {
      const source = String(item?.source || '');
      const target = String(item?.target || '');

      if (
        !sourceSet.has(source) ||
        !targetSet.has(target) ||
        usedSources.has(source) ||
        usedTargets.has(target)
      ) {
        throw new Error(`Invalid or duplicate mapping: ${source}`);
      }

      usedSources.add(source);
      usedTargets.add(target);
      validatedMappings.push({ source, target });
    }

    if (!usedTargets.has('name')) {
      throw new Error('Product Name mapping is required.');
    }

    const { mapping, schema } = getRefs(req);
    const db = getFirestore();

    await db.runTransaction(async transaction => {
      const schemaSnap = await transaction.get(schema);

      const existingFields = schemaSnap.exists
        ? schemaSnap.data().fields || []
        : [];

      const allFields = [...DEFAULT_FIELDS];
      const knownKeys = new Set(DEFAULT_FIELDS.map(f => f.key));

      for (const field of [...existingFields, ...validatedCustom]) {
        if (
          field &&
          keyPattern.test(field.key || '') &&
          !knownKeys.has(field.key)
        ) {
          allFields.push(field);
          knownKeys.add(field.key);
        }
      }

      transaction.set(schema, {
        fields: allFields,
        version: 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: req.owner.uid
      }, { merge: true });

      transaction.set(mapping, {
        columns,
        mappings: validatedMappings,
        customFields: validatedCustom,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: req.owner.uid
      });
    });

    return res.json({
      success: true,
      message: 'Import mapping and product schema saved successfully.'
    });
  } catch (error) {
    console.error('Mapping save:', error);
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
});


function importNumber(value, fallback = null) {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function importCustomValue(value, type) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  if (type === 'number') {
    const number = importNumber(value);
    if (!Number.isFinite(number)) {
      throw new Error('Invalid custom number.');
    }
    return number;
  }

  if (type === 'boolean') {
    const text = String(value).trim().toLowerCase();
    if (['yes', 'true', '1'].includes(text)) return true;
    if (['no', 'false', '0'].includes(text)) return false;
    throw new Error('Invalid Yes/No value.');
  }

  if (type === 'date') {
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        Number.isNaN(Date.parse(text))) {
      throw new Error('Invalid date. Use YYYY-MM-DD.');
    }
    return text;
  }

  const text = String(value).trim();

  if (text.length > 1000) {
    throw new Error('Custom field value is too long.');
  }

  if (type === 'image' && !/^https:\/\//i.test(text)) {
    return undefined;
  }

  return text;
}

// ACTUAL PRODUCT IMPORT
// Uses the saved mapping and imports up to 30 rows per request.
router.post('/import', async (req, res) => {
  try {
    const { rows } = req.body || {};

    if (
      !Array.isArray(rows) ||
      rows.length < 1 ||
      rows.length > 30
    ) {
      return res.status(400).json({
        success: false,
        message: 'Send between 1 and 30 product rows.'
      });
    }

    const db = getFirestore();
    const businessRef = db.collection('businesses')
      .doc(req.owner.businessId);

    const mappingSnap = await businessRef
      .collection('settings')
      .doc('importMapping')
      .get();

    if (!mappingSnap.exists) {
      return res.status(400).json({
        success: false,
        message: 'Save column mapping before importing products.'
      });
    }

    const saved = mappingSnap.data();
    const mappings = saved.mappings || [];
    const customDefinitions = saved.customFields || [];

    const customTypes = new Map(
      customDefinitions.map(field => [field.key, field.type])
    );

    const standardKeys = new Set(
      DEFAULT_FIELDS.map(field => field.key)
    );

    const productsRef = businessRef.collection('products');

    const results = {
      imported: 0,
      skipped: 0,
      errors: []
    };

    const seenSKUs = new Set();

    for (let index = 0; index < rows.length; index++) {
      const item = rows[index];

      try {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item)
        ) {
          throw new Error('Invalid row.');
        }

        const mapped = {};
        const customFields = {};

        for (const { source, target } of mappings) {
          const value = item[source];

          if (standardKeys.has(target)) {
            mapped[target] = value;
          } else if (customTypes.has(target)) {
            const parsed = importCustomValue(
              value,
              customTypes.get(target)
            );

            if (parsed !== undefined) {
              customFields[target] = parsed;
            }
          }
        }

        const name = String(mapped.name ?? '').trim();
        const sku = String(mapped.sku ?? '').trim();
        const barcode = String(mapped.barcode ?? '').trim();
        const category = String(mapped.category ?? 'General').trim();

        const purchasePrice = importNumber(
          mapped.purchasePrice, 0
        );

        const sellingPrice = importNumber(
          mapped.sellingPrice, 0
        );

        const stock = importNumber(mapped.stock, 0);
        const lowStockThreshold = importNumber(
          mapped.lowStockThreshold, 5
        );

        if (!name || name.length > 150) {
          throw new Error('Invalid product name.');
        }

        if (!sku || sku.length > 80) {
          throw new Error('SKU is missing or invalid.');
        }

        if (barcode.length > 100 || category.length > 100) {
          throw new Error('Invalid barcode or category.');
        }

        if (
          !Number.isFinite(purchasePrice) ||
          !Number.isFinite(sellingPrice) ||
          purchasePrice < 0 ||
          sellingPrice < 0
        ) {
          throw new Error('Invalid product price.');
        }

        if (
          !Number.isSafeInteger(stock) ||
          !Number.isSafeInteger(lowStockThreshold) ||
          stock < 0 ||
          lowStockThreshold < 0
        ) {
          throw new Error('Invalid stock quantity.');
        }

        if (seenSKUs.has(sku)) {
          throw new Error('Duplicate SKU in this batch.');
        }

        seenSKUs.add(sku);

        const duplicate = await productsRef
          .where('sku', '==', sku)
          .limit(1)
          .get();

        if (!duplicate.empty) {
          throw new Error('SKU already exists. Skipped.');
        }

        // Only HTTPS image URLs are supported for now.
        // Local filenames such as necklace.jpg are ignored.
        const rawImage = String(mapped.imageUrl ?? '').trim();

        const imageUrl =
          rawImage.length <= 2000 && /^https:\/\//i.test(rawImage)
            ? rawImage
            : '';

        await productsRef.add({
          name,
          sku,
          barcode,
          category: category || 'General',
          purchasePrice,
          sellingPrice,
          stock,
          lowStockThreshold,
          imageUrl,
          customFields,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: req.owner.uid,
          source: 'csv_import'
        });

        results.imported++;

      } catch (rowError) {
        results.skipped++;
        results.errors.push({
          index,
          message: rowError.message
        });
      }
    }

    return res.json({
      success: true,
      message: `${results.imported} products imported.`,
      ...results
    });

  } catch (error) {
    console.error('Product import error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to import products.'
    });
  }
});

module.exports = router;
