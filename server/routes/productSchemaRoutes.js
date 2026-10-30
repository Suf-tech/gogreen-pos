
const express = require('express');
const {
  getFirestore,
  FieldValue
} = require('firebase-admin/firestore');

const verifyBusinessOwner = require('../middleware/verifyBusinessOwner');

const router = express.Router();

router.use(verifyBusinessOwner);

// Default fields available for every business
const DEFAULT_FIELDS = [
  {
    key: 'name',
    label: 'Product Name',
    type: 'text',
    required: true
  },
  {
    key: 'sku',
    label: 'SKU',
    type: 'text',
    required: true
  },
  {
    key: 'barcode',
    label: 'Barcode',
    type: 'text',
    required: false
  },
  {
    key: 'category',
    label: 'Category',
    type: 'text',
    required: false
  },
  {
    key: 'purchasePrice',
    label: 'Purchase Price',
    type: 'number',
    required: true
  },
  {
    key: 'sellingPrice',
    label: 'Selling Price',
    type: 'number',
    required: true
  },
  {
    key: 'stock',
    label: 'Stock Quantity',
    type: 'number',
    required: true
  },
  {
    key: 'lowStockThreshold',
    label: 'Low Stock Alert',
    type: 'number',
    required: true
  },
  {
    key: 'imageUrl',
    label: 'Product Image',
    type: 'image',
    required: false
  }
];

const ALLOWED_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'image'
];

function getSchemaRef(req) {
  return getFirestore()
    .collection('businesses')
    .doc(req.owner.businessId)
    .collection('settings')
    .doc('productSchema');
}

// GET PRODUCT SCHEMA
router.get('/', async (req, res) => {
  try {
    const snapshot = await getSchemaRef(req).get();

    if (!snapshot.exists) {
      return res.json({
        success: true,
        isDefault: true,
        fields: DEFAULT_FIELDS
      });
    }

    return res.json({
      success: true,
      isDefault: false,
      fields: snapshot.data().fields || DEFAULT_FIELDS
    });

  } catch (error) {
    console.error('Product schema error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load product schema.'
    });
  }
});

// SAVE CUSTOM PRODUCT FIELDS
router.put('/', async (req, res) => {
  try {
    const customFields = req.body.customFields;

    if (
      !Array.isArray(customFields) ||
      customFields.length > 50
    ) {
      return res.status(400).json({
        success: false,
        message: 'Provide up to 50 custom fields.'
      });
    }

    const seen = new Set(
      DEFAULT_FIELDS.map(field => field.key)
    );

    const validated = customFields.map(field => {
      if (!field || typeof field !== 'object') {
        throw new Error('Invalid field definition.');
      }

      const key = String(field.key || '').trim();
      const label = String(field.label || '').trim();
      const type = String(field.type || '').trim();

      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key)) {
        throw new Error(`Invalid field key: ${key}`);
      }

      if (seen.has(key)) {
        throw new Error(`Duplicate field: ${key}`);
      }

      if (!label || label.length > 100) {
        throw new Error(`Invalid label: ${key}`);
      }

      if (!ALLOWED_TYPES.includes(type)) {
        throw new Error(`Unsupported type: ${type}`);
      }

      seen.add(key);

      return {
        key,
        label,
        type,
        required: field.required === true
      };
    });

    const reference = getSchemaRef(req);
    const existing = await reference.get();

    // Preserve fields previously added to this business
    const previousCustomFields = existing.exists
      ? (existing.data().fields || []).filter(
          field => !DEFAULT_FIELDS.some(
            standard => standard.key === field.key
          )
        )
      : [];

    for (const field of previousCustomFields) {
      if (!seen.has(field.key)) {
        validated.push(field);
        seen.add(field.key);
      }
    }

    const fields = [
      ...DEFAULT_FIELDS,
      ...validated
    ];

    await reference.set({
      fields,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.owner.uid,
      version: 1
    }, { merge: true });

    return res.json({
      success: true,
      message: 'Product schema saved successfully.',
      fields
    });

  } catch (error) {
    console.error('Schema save error:', error);

    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
