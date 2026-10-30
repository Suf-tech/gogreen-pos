
import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import './OwnerProducts.css';

const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000';

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

const standardKeys = new Set(DEFAULT_FIELDS.map(field => field.key));

const emptyForm = {
  name: '',
  sku: '',
  barcode: '',
  category: '',
  purchasePrice: '',
  sellingPrice: '',
  stock: '',
  lowStockThreshold: '5',
  imageUrl: '',
  customFields: {}
};

const money = value =>
  `Rs. ${Number(value || 0).toLocaleString('en-PK', {
    maximumFractionDigits: 2
  })}`;

function getStockStatus(product) {
  const stock = Number(product.stock || 0);
  const threshold = Number(product.lowStockThreshold || 0);

  if (stock <= 0) {
    return { label: 'Out of Stock', className: 'out' };
  }

  if (stock <= threshold) {
    return { label: 'Low Stock', className: 'low' };
  }

  return { label: 'In Stock', className: 'in' };
}

function formatCustomValue(value, field) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (field.type === 'boolean') {
    if (value === true || value === 'true') return 'Yes';
    if (value === false || value === 'false') return 'No';
  }

  if (field.type === 'number') {
    const number = Number(value);

    return Number.isFinite(number)
      ? number.toLocaleString('en-PK')
      : String(value);
  }

  if (field.type === 'date') {
    if (typeof value === 'string') return value;

    if (value?.seconds) {
      return new Date(value.seconds * 1000).toLocaleDateString('en-PK');
    }
  }

  return String(value);
}

function ProductAvatar({ product }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [product.imageUrl]);

  return (
    <div className="op-product-avatar">
      {product.imageUrl && !imageFailed ? (
        <img
          src={product.imageUrl}
          alt={product.name}
          onError={() => setImageFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '10px'
          }}
        />
      ) : (
        product.name?.charAt(0)?.toUpperCase() || 'P'
      )}
    </div>
  );
}

export default function OwnerProducts() {
  const [products, setProducts] = useState([]);
  const [fields, setFields] = useState(DEFAULT_FIELDS);

  const [schemaLoading, setSchemaLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  // Dynamically read every business-specific field.
  const customFields = useMemo(
    () =>
      fields.filter(
        field => field?.key && !standardKeys.has(field.key)
      ),
    [fields]
  );

  const request = useCallback(async (endpoint, options = {}) => {
    const user = auth.currentUser;

    if (!user) {
      throw new Error('Session expired. Please login again.');
    }

    const token = await user.getIdToken();

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers
      }
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.success) {
      throw new Error(
        result.message || 'Unable to complete request.'
      );
    }

    return result;
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);

    try {
      const result = await request('/api/owner/products/');
      setProducts(result.products || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true);

    try {
      const result = await request('/api/owner/product-schema/');

      setFields(
        Array.isArray(result.fields) && result.fields.length
          ? result.fields
          : DEFAULT_FIELDS
      );
    } catch (err) {
      setError(`Product schema: ${err.message}`);
    } finally {
      setSchemaLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadSchema();
    loadProducts();
  }, [loadSchema, loadProducts]);

  async function refreshInventory() {
    setError('');
    await Promise.all([loadSchema(), loadProducts()]);
  }

  const categories = useMemo(
    () =>
      [
        ...new Set(
          products.map(product => product.category).filter(Boolean)
        )
      ].sort(),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();

    return products.filter(product => {
      const values = [
        product.name,
        product.sku,
        product.barcode,
        product.category,
        ...Object.values(product.customFields || {})
      ];

      const matchesSearch =
        !term ||
        values.some(value =>
          String(value ?? '').toLowerCase().includes(term)
        );

      const matchesCategory =
        categoryFilter === 'all' ||
        product.category === categoryFilter;

      const status = getStockStatus(product);

      const matchesStock =
        stockFilter === 'all' ||
        stockFilter === status.className;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStock
      );
    });
  }, [products, search, categoryFilter, stockFilter]);

  const stats = useMemo(
    () => ({
      total: products.length,
      inStock: products.filter(
        product => getStockStatus(product).className === 'in'
      ).length,
      lowStock: products.filter(
        product => getStockStatus(product).className === 'low'
      ).length,
      outOfStock: products.filter(
        product => getStockStatus(product).className === 'out'
      ).length
    }),
    [products]
  );

  function openAdd() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      customFields: {}
    });
    setError('');
    setSuccess('');
    setShowForm(true);
  }

  function openEdit(product) {
    setEditingId(product.id);

    setForm({
      name: product.name || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      category: product.category || '',
      purchasePrice: String(product.purchasePrice ?? ''),
      sellingPrice: String(product.sellingPrice ?? ''),
      stock: String(product.stock ?? ''),
      lowStockThreshold: String(product.lowStockThreshold ?? 5),
      imageUrl: product.imageUrl || '',
      customFields: {
        ...(product.customFields || {})
      }
    });

    setError('');
    setSuccess('');
    setShowForm(true);
  }

  function updateField(event) {
    const { name, value } = event.target;

    setForm(previous => ({
      ...previous,
      [name]: value
    }));
  }

  function updateCustomField(key, value) {
    setForm(previous => ({
      ...previous,
      customFields: {
        ...previous.customFields,
        [key]: value
      }
    }));
  }

  function renderCustomInput(field) {
    const value = form.customFields[field.key];

    if (field.type === 'boolean') {
      return (
        <select
          value={
            value === true || value === 'true'
              ? 'true'
              : value === false || value === 'false'
                ? 'false'
                : ''
          }
          onChange={event => {
            const selected = event.target.value;

            updateCustomField(
              field.key,
              selected === ''
                ? ''
                : selected === 'true'
            );
          }}
          required={field.required}
        >
          <option value="">Select</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }

    const type =
      field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'image'
            ? 'url'
            : 'text';

    return (
      <input
        type={type}
        value={value ?? ''}
        onChange={event =>
          updateCustomField(field.key, event.target.value)
        }
        placeholder={
          field.type === 'image'
            ? 'https://example.com/image.jpg'
            : `Enter ${field.label}`
        }
        step={field.type === 'number' ? 'any' : undefined}
        maxLength={
          field.type === 'text' ? 1000 : undefined
        }
        required={field.required}
      />
    );
  }

  async function handleSave(event) {
    event.preventDefault();

    if (saving) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        barcode: form.barcode.trim(),
        category: form.category.trim() || 'General',
        purchasePrice: Number(form.purchasePrice),
        sellingPrice: Number(form.sellingPrice),
        stock: Number(form.stock),
        lowStockThreshold: Number(form.lowStockThreshold),
        imageUrl: form.imageUrl.trim(),
        customFields: {}
      };

      if (
        !payload.name ||
        !payload.sku ||
        form.purchasePrice === '' ||
        form.sellingPrice === '' ||
        form.stock === '' ||
        form.lowStockThreshold === ''
      ) {
        throw new Error('Please complete all required fields.');
      }

      if (
        !Number.isFinite(payload.purchasePrice) ||
        !Number.isFinite(payload.sellingPrice) ||
        payload.purchasePrice < 0 ||
        payload.sellingPrice < 0 ||
        !Number.isSafeInteger(payload.stock) ||
        !Number.isSafeInteger(payload.lowStockThreshold) ||
        payload.stock < 0 ||
        payload.lowStockThreshold < 0
      ) {
        throw new Error(
          'Please enter valid prices and stock values.'
        );
      }

      for (const field of customFields) {
        const raw = form.customFields[field.key];

        if (
          raw === '' ||
          raw === null ||
          raw === undefined
        ) {
          if (field.required) {
            throw new Error(`${field.label} is required.`);
          }
          continue;
        }

        if (field.type === 'number') {
          const number = Number(raw);

          if (!Number.isFinite(number)) {
            throw new Error(
              `${field.label} must be a valid number.`
            );
          }

          payload.customFields[field.key] = number;
        } else {
          payload.customFields[field.key] = raw;
        }
      }

      const isEditing = Boolean(editingId);

      await request(
        isEditing
          ? `/api/owner/products/${editingId}`
          : '/api/owner/products/',
        {
          method: isEditing ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        }
      );

      setShowForm(false);
      setEditingId(null);
      setForm({
        ...emptyForm,
        customFields: {}
      });

      await loadProducts();

      setSuccess(
        isEditing
          ? 'Product updated successfully.'
          : 'Product added successfully.'
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product) {
    if (deletingId) return;

    const confirmed = window.confirm(
      `Delete "${product.name}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingId(product.id);
    setError('');
    setSuccess('');

    try {
      await request(`/api/owner/products/${product.id}`, {
        method: 'DELETE'
      });

      setProducts(previous =>
        previous.filter(item => item.id !== product.id)
      );

      setSuccess('Product deleted successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="op-products">
      <div className="op-page-heading">
        <div>
          <span className="op-eyebrow">
            INVENTORY MANAGEMENT
          </span>
          <h1>Products & Inventory</h1>
          <p>
            Manage products, prices, custom fields and stock
            from one place.
          </p>
        </div>

        <button
          className="op-primary-btn"
          type="button"
          onClick={openAdd}
          disabled={schemaLoading}
        >
          + Add Product
        </button>
      </div>

      {error && (
        <div
          className="op-alert op-alert-error"
          role="alert"
        >
          {error}
          <button
            type="button"
            onClick={() => setError('')}
          >
            ×
          </button>
        </div>
      )}

      {success && (
        <div
          className="op-alert op-alert-success"
          role="status"
        >
          {success}
          <button
            type="button"
            onClick={() => setSuccess('')}
          >
            ×
          </button>
        </div>
      )}

      <div className="op-stats">
        {[
          {
            title: 'Total Products',
            value: stats.total,
            icon: '◈'
          },
          {
            title: 'In Stock',
            value: stats.inStock,
            icon: '✓'
          },
          {
            title: 'Low Stock',
            value: stats.lowStock,
            icon: '!'
          },
          {
            title: 'Out of Stock',
            value: stats.outOfStock,
            icon: '×'
          }
        ].map(item => (
          <div className="op-stat" key={item.title}>
            <div className="op-stat-head">
              <span>{item.title}</span>
              <span className="op-stat-symbol">
                {item.icon}
              </span>
            </div>

            <strong>
              {loading ? '...' : item.value}
            </strong>
          </div>
        ))}
      </div>

      <div className="op-panel">
        <div className="op-panel-heading">
          <div>
            <h3>Product List</h3>
            <p>
              {filteredProducts.length} product(s) displayed
              {products.length === 500
                ? ' — showing up to 500 records'
                : ''}
            </p>
          </div>

          <button
            type="button"
            className="op-refresh-btn"
            onClick={refreshInventory}
            disabled={loading || schemaLoading}
          >
            ↻ Refresh
          </button>
        </div>

        <div className="op-filters">
          <input
            type="search"
            placeholder="Search name, SKU, barcode, custom fields..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            aria-label="Search products"
          />

          <select
            value={categoryFilter}
            onChange={event =>
              setCategoryFilter(event.target.value)
            }
            aria-label="Filter by category"
          >
            <option value="all">All Categories</option>

            {categories.map(category => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <select
            value={stockFilter}
            onChange={event =>
              setStockFilter(event.target.value)
            }
            aria-label="Filter by stock status"
          >
            <option value="all">All Stock</option>
            <option value="in">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>

        {loading ? (
          <div className="op-empty">
            <div className="spinner-border text-success" />
            <p>Loading inventory...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="op-empty">
            <div className="op-empty-icon">◈</div>

            <h3>
              {products.length === 0
                ? 'Your inventory is empty'
                : 'No matching products'}
            </h3>

            <p>
              {products.length === 0
                ? 'Add your first product to start managing stock.'
                : 'Try changing your search or filters.'}
            </p>

            {products.length === 0 && (
              <button
                type="button"
                className="op-primary-btn"
                onClick={openAdd}
              >
                + Add First Product
              </button>
            )}
          </div>
        ) : (
          <div className="op-table-wrap">
            <table className="op-table">
              <thead>
                <tr>
                  <th>PRODUCT</th>
                  <th>SKU / BARCODE</th>
                  <th>CATEGORY</th>

                  {/* Dynamic custom field headings */}
                  {customFields.map(field => (
                    <th key={field.key}>
                      {field.label.toUpperCase()}
                    </th>
                  ))}

                  <th>PURCHASE</th>
                  <th>SELLING</th>
                  <th>STOCK</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map(product => {
                  const status = getStockStatus(product);

                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="op-product-cell">
                          <ProductAvatar product={product} />
                          <strong>{product.name}</strong>
                        </div>
                      </td>

                      <td>
                        <strong>{product.sku}</strong>
                        <small>
                          {product.barcode || 'No barcode'}
                        </small>
                      </td>

                      <td>
                        {product.category || 'General'}
                      </td>

                      {/* Dynamic custom field values */}
                      {customFields.map(field => {
                        const value =
                          product.customFields?.[field.key];

                        return (
                          <td key={field.key}>
                            {field.type === 'image' &&
                            typeof value === 'string' &&
                            /^https:\/\//i.test(value) ? (
                              <a
                                href={value}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                View Image
                              </a>
                            ) : (
                              <strong>
                                {formatCustomValue(
                                  value,
                                  field
                                )}
                              </strong>
                            )}
                          </td>
                        );
                      })}

                      <td>
                        {money(product.purchasePrice)}
                      </td>

                      <td>
                        <strong>
                          {money(product.sellingPrice)}
                        </strong>
                      </td>

                      <td>
                        <strong>{product.stock}</strong>
                        <small>
                          Alert at {product.lowStockThreshold}
                        </small>
                      </td>

                      <td>
                        <span
                          className={`op-stock-badge ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>

                      <td>
                        <div className="op-row-actions">
                          <button
                            type="button"
                            onClick={() => openEdit(product)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="op-delete-btn"
                            disabled={deletingId === product.id}
                            onClick={() => handleDelete(product)}
                          >
                            {deletingId === product.id
                              ? 'Deleting...'
                              : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div
          className="op-modal-backdrop"
          onMouseDown={event => {
            if (
              event.target === event.currentTarget &&
              !saving
            ) {
              setShowForm(false);
            }
          }}
        >
          <div
            className="op-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="op-modal-title"
          >
            <div className="op-modal-header">
              <div>
                <span className="op-eyebrow">
                  PRODUCT DETAILS
                </span>

                <h2 id="op-modal-title">
                  {editingId
                    ? 'Edit Product'
                    : 'Add New Product'}
                </h2>
              </div>

              <button
                type="button"
                className="op-modal-close"
                onClick={() => setShowForm(false)}
                disabled={saving}
                aria-label="Close form"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div className="op-modal-body">
                <div className="op-form-grid">
                  <label className="op-full">
                    Product Name *
                    <input
                      name="name"
                      value={form.name}
                      onChange={updateField}
                      placeholder="e.g. Gold Plated Necklace"
                      maxLength={150}
                      required
                    />
                  </label>

                  <label>
                    SKU *
                    <input
                      name="sku"
                      value={form.sku}
                      onChange={updateField}
                      placeholder="e.g. JWL-001"
                      maxLength={80}
                      required
                    />
                  </label>

                  <label>
                    Barcode
                    <input
                      name="barcode"
                      value={form.barcode}
                      onChange={updateField}
                      placeholder="Optional"
                      maxLength={100}
                    />
                  </label>

                  <label className="op-full">
                    Category
                    <input
                      name="category"
                      value={form.category}
                      onChange={updateField}
                      placeholder="e.g. Necklaces"
                      maxLength={100}
                      list="op-category-options"
                    />

                    <datalist id="op-category-options">
                      {categories.map(category => (
                        <option
                          key={category}
                          value={category}
                        />
                      ))}
                    </datalist>
                  </label>

                  <label>
                    Purchase Price (Rs.) *
                    <input
                      name="purchasePrice"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.purchasePrice}
                      onChange={updateField}
                      required
                    />
                  </label>

                  <label>
                    Selling Price (Rs.) *
                    <input
                      name="sellingPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.sellingPrice}
                      onChange={updateField}
                      required
                    />
                  </label>

                  <label>
                    Current Stock *
                    <input
                      name="stock"
                      type="number"
                      min="0"
                      step="1"
                      value={form.stock}
                      onChange={updateField}
                      required
                    />
                  </label>

                  <label>
                    Low Stock Alert At *
                    <input
                      name="lowStockThreshold"
                      type="number"
                      min="0"
                      step="1"
                      value={form.lowStockThreshold}
                      onChange={updateField}
                      required
                    />
                  </label>

                  {customFields.length > 0 && (
                    <div
                      className="op-full"
                      style={{
                        marginTop: '8px',
                        borderTop: '1px solid #e7eee9',
                        paddingTop: '18px'
                      }}
                    >
                      <h3
                        style={{
                          fontSize: '15px',
                          fontWeight: 800,
                          marginBottom: '6px'
                        }}
                      >
                        Business-Specific Fields
                      </h3>

                      <p
                        style={{
                          fontSize: '12px',
                          color: '#829087',
                          marginBottom: '15px'
                        }}
                      >
                        Automatically loaded from your
                        business product schema.
                      </p>

                      <div className="op-form-grid">
                        {customFields.map(field => (
                          <label key={field.key}>
                            {field.label}
                            {field.required ? ' *' : ''}
                            {renderCustomInput(field)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="op-full">
                    Product Image URL (Optional)
                    <input
                      type="url"
                      name="imageUrl"
                      value={form.imageUrl}
                      onChange={updateField}
                      placeholder="https://example.com/product.jpg"
                      maxLength={2000}
                    />
                  </label>
                </div>

                {form.imageUrl &&
                  /^https:\/\//i.test(form.imageUrl) && (
                    <div style={{ marginTop: '15px' }}>
                      <p
                        style={{
                          fontSize: '12px',
                          color: '#829087'
                        }}
                      >
                        Image Preview
                      </p>

                      <img
                        src={form.imageUrl}
                        alt="Product preview"
                        style={{
                          width: '100px',
                          height: '100px',
                          objectFit: 'cover',
                          borderRadius: '10px',
                          border: '1px solid #e7eee9'
                        }}
                      />
                    </div>
                  )}

                <p className="op-form-note">
                  Custom fields are saved with your product.
                  CSV/Excel bulk import is available from
                  Import & Column Mapping.
                  Direct image uploads are not enabled yet.
                </p>
              </div>

              <div className="op-modal-footer">
                <button
                  type="button"
                  className="op-cancel-btn"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="op-primary-btn"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving...'
                    : editingId
                      ? 'Save Changes'
                      : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}