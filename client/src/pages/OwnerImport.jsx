
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { auth } from '../firebase';
import './OwnerImport.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const standardFields = [
  { key: 'name', label: 'Product Name', type: 'text' },
  { key: 'sku', label: 'SKU', type: 'text' },
  { key: 'barcode', label: 'Barcode', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'number' },
  { key: 'sellingPrice', label: 'Selling Price', type: 'number' },
  { key: 'stock', label: 'Stock Quantity', type: 'number' },
  { key: 'lowStockThreshold', label: 'Low Stock Alert', type: 'number' },
  { key: 'imageUrl', label: 'Product Image', type: 'image' }
];

const suggestions = {
  name: ['name', 'productname', 'itemname', 'itemtitle', 'title', 'medicinename'],
  sku: ['sku', 'productcode', 'itemcode', 'code'],
  barcode: ['barcode', 'ean', 'upc'],
  category: ['category', 'categoryname', 'group'],
  purchasePrice: ['purchaseprice', 'cost', 'costprice', 'buyprice'],
  sellingPrice: ['sellingprice', 'price', 'retailprice', 'salerate', 'saleprice'],
  stock: ['stock', 'quantity', 'qty', 'availableqty'],
  lowStockThreshold: ['lowstockthreshold', 'reorderlevel', 'minimumstock'],
  imageUrl: ['image', 'imageurl', 'imagepath', 'itemphoto', 'photo', 'picture']
};

const normalize = value =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function guessTarget(column) {
  const value = normalize(column);

  for (const [target, aliases] of Object.entries(suggestions)) {
    if (aliases.includes(value)) return target;
  }

  return '';
}

function makeKey(source) {
  let key = String(source)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!/^[a-zA-Z]/.test(key)) key = `field_${key}`;

  return key.slice(0, 50) || 'customField';
}

function buildMapping(columns, mapping, customTypes, savedMapping) {
  const standardKeys = new Set(standardFields.map(field => field.key));
  const usedKeys = new Set(standardKeys);
  const customFields = [];
  const mappings = [];
  const usedTargets = new Set();

  for (const source of columns) {
    const selected = mapping[source];

    if (!selected) continue;

    let target = selected;

    if (selected === '__custom__') {
      const previous = savedMapping?.mappings?.find(
        item => item.source === source
      );

      const previousCustom = savedMapping?.customFields?.find(
        field => field.key === previous?.target
      );

      // Reuse an existing custom key where possible.
      if (previousCustom && !usedKeys.has(previousCustom.key)) {
        target = previousCustom.key;
      } else {
        const base = makeKey(source);
        target = base;
        let counter = 2;

        while (usedKeys.has(target)) {
          const suffix = `_${counter++}`;
          target = base.slice(0, 50 - suffix.length) + suffix;
        }
      }

      usedKeys.add(target);

      customFields.push({
        key: target,
        label: source,
        type: customTypes[source] || previousCustom?.type || 'text',
        required: false
      });
    }

    if (usedTargets.has(target)) {
      throw new Error(
        `Multiple columns are mapped to the same field: ${target}`
      );
    }

    usedTargets.add(target);
    mappings.push({ source, target });
  }

  if (!usedTargets.has('name')) {
    throw new Error('Map a column to Product Name.');
  }

  if (!usedTargets.has('sku')) {
    throw new Error('Map a column to SKU before importing.');
  }

  return { columns, mappings, customFields };
}

export default function OwnerImport() {
  const [fileName, setFileName] = useState('');
  const [columns, setColumns] = useState([]);
  const [preview, setPreview] = useState([]);
  const [allRows, setAllRows] = useState([]);

  const [mapping, setMapping] = useState({});
  const [customTypes, setCustomTypes] = useState({});
  const [savedMapping, setSavedMapping] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importReport, setImportReport] = useState(null);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function api(path, options = {}) {
    const user = auth.currentUser;

    if (!user) throw new Error('Please login again.');

    const token = await user.getIdToken();

    const response = await fetch(
      `${API_URL}/api/owner/import-mapping${path}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...options.headers
        }
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(data.message || `Request failed (${response.status}).`);
    }

    return data;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api('/');

        if (!cancelled) {
          setSavedMapping(data.mapping || null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    setError('');
    setSuccess('');
    setLoading(true);
    setFileName('');
    setColumns([]);
    setPreview([]);
    setAllRows([]);
    setMapping({});
    setCustomTypes({});
    setImportReport(null);
    setImportProgress(0);

    try {
      if (!/\.(xlsx|csv)$/i.test(file.name)) {
        throw new Error('Please select a .xlsx or .csv file.');
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Maximum file size is 5 MB.');
      }

      const buffer = await file.arrayBuffer();

      const workbook = XLSX.read(buffer, {
        type: 'array',
        cellDates: true
      });

      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        throw new Error('Spreadsheet is empty.');
      }

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        blankrows: false
      });

      if (rows.length < 2) {
        throw new Error('File must contain headers and product rows.');
      }

      const headers = rows[0].map(value => String(value).trim());

      if (
        headers.some(header => !header) ||
        new Set(headers).size !== headers.length
      ) {
        throw new Error(
          'First row must contain unique, non-empty column names.'
        );
      }

      if (headers.length > 100) {
        throw new Error('Maximum 100 columns are supported.');
      }

      const productRows = rows.slice(1)
        .filter(row =>
          row.some(value => String(value ?? '').trim() !== '')
        )
        .map(row => {
          const result = {};

          headers.forEach((header, index) => {
            const value = row[index];

            result[header] =
              value instanceof Date
                ? value.toISOString().slice(0, 10)
                : String(value ?? '');
          });

          return result;
        });

      if (!productRows.length) {
        throw new Error('No product rows found.');
      }

      const initialMapping = {};
      const initialTypes = {};
      const used = new Set();

      headers.forEach(header => {
        const previous = savedMapping?.mappings?.find(
          item => item.source === header
        );

        const previousCustom = savedMapping?.customFields?.find(
          field => field.key === previous?.target
        );

        let target = '';

        if (previousCustom) {
          target = '__custom__';
          initialTypes[header] = previousCustom.type || 'text';
        } else {
          target = previous?.target || guessTarget(header);
        }

        if (target === '__custom__' || (target && !used.has(target))) {
          initialMapping[header] = target;

          if (target !== '__custom__') used.add(target);
        } else {
          initialMapping[header] = '';
        }
      });

      setFileName(file.name);
      setColumns(headers);
      setPreview(productRows.slice(0, 5));
      setAllRows(productRows);
      setMapping(initialMapping);
      setCustomTypes(initialTypes);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  }

  function updateMapping(source, target) {
    setMapping(previous => ({
      ...previous,
      [source]: target
    }));

    setSuccess('');
    setImportReport(null);
  }

  async function saveMappingOnly() {
    if (saving || importing) return;

    setError('');
    setSuccess('');

    try {
      if (!columns.length) {
        throw new Error('Please select a file first.');
      }

      const payload = buildMapping(
        columns,
        mapping,
        customTypes,
        savedMapping
      );

      setSaving(true);

      await api('/', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      setSavedMapping(payload);
      setSuccess('Column mapping saved successfully.');

    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveAndImport() {
    if (saving || importing || loading) return;

    setError('');
    setSuccess('');
    setImportReport(null);
    setImportProgress(0);

    if (!allRows.length) {
      setError('Please select a CSV or Excel file first.');
      return;
    }

    const report = {
      imported: 0,
      skipped: 0,
      errors: []
    };

    let processed = 0;

    try {
      const payload = buildMapping(
        columns,
        mapping,
        customTypes,
        savedMapping
      );

      // Save the schema and column mapping first.
      setSaving(true);

      await api('/', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      setSavedMapping(payload);
      setSaving(false);

      // Import the SAME selected file, without uploading again.
      setImporting(true);

      const batchSize = 30;

      for (
        let start = 0;
        start < allRows.length;
        start += batchSize
      ) {
        const batch = allRows.slice(start, start + batchSize);

        const result = await api('/import', {
          method: 'POST',
          body: JSON.stringify({ rows: batch })
        });

        report.imported += result.imported || 0;
        report.skipped += result.skipped || 0;

        for (const issue of result.errors || []) {
          report.errors.push({
            row: start + issue.index + 2,
            message: issue.message
          });
        }

        processed += batch.length;
        setImportProgress(processed);
      }

      setImportReport(report);

      setSuccess(
        `Import completed! ${report.imported} products imported, ` +
        `${report.skipped} skipped.`
      );

    } catch (err) {
      setImportReport(processed > 0 ? report : null);

      setError(
        processed > 0
          ? `${err.message} Import stopped after ${processed} rows. ` +
            'Previously imported products remain saved.'
          : err.message
      );
    } finally {
      setSaving(false);
      setImporting(false);
    }
  }

  return (
    <div className="oi-page">
      <div className="oi-heading">
        <span className="oi-eyebrow">DATABASE MIGRATION</span>
        <h1>Import & Column Mapping</h1>
        <p>
          Connect your existing product database columns with
          GoGreen POS fields and import products into inventory.
        </p>
      </div>

      {error && (
        <div className="oi-alert oi-error">{error}</div>
      )}

      {success && (
        <div className="oi-alert oi-success">{success}</div>
      )}

      {importReport && (
        <div className="oi-card">
          <h3>Import Results</h3>
          <p>
            Successfully imported: <strong>{importReport.imported}</strong>
          </p>
          <p>
            Skipped rows: <strong>{importReport.skipped}</strong>
          </p>

          {importReport.errors.length > 0 && (
            <div className="oi-table-wrap">
              <table className="oi-table">
                <thead>
                  <tr>
                    <th>CSV ROW</th>
                    <th>REASON</th>
                  </tr>
                </thead>
                <tbody>
                  {importReport.errors.map((issue, index) => (
                    <tr key={index}>
                      <td>{issue.row}</td>
                      <td>{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="oi-card">
        <h3>1. Select Existing Product File</h3>
        <p>
          Select a CSV or Excel file. The first row should
          contain column names.
        </p>

        <label className="oi-upload">
          <span className="oi-upload-icon">⇧</span>
          <strong>
            {loading ? 'Reading file...' : 'Choose Excel / CSV File'}
          </strong>
          <small>Supported: .xlsx, .csv — maximum 5 MB</small>

          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFile}
            disabled={loading || saving || importing}
          />
        </label>

        {fileName && columns.length > 0 && (
          <div className="oi-file-info">
            ✓ {fileName} — {columns.length} columns,
            {' '}{allRows.length} products detected
          </div>
        )}
      </div>

      {columns.length > 0 && (
        <>
          <div className="oi-card">
            <h3>2. Preview Existing Data</h3>
            <p>Showing up to five sample rows from your file.</p>

            <div className="oi-table-wrap">
              <table className="oi-table">
                <thead>
                  <tr>
                    {columns.map(col => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {preview.map((row, index) => (
                    <tr key={index}>
                      {columns.map(col => (
                        <td key={col}>{row[col]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="oi-card">
            <h3>3. Match Database Columns</h3>
            <p>
              Choose the GoGreen POS field for each source column.
              Use Custom Field to preserve additional information.
            </p>

            <div className="oi-mapping-list">
              {columns.map(source => (
                <div className="oi-mapping-row" key={source}>
                  <div className="oi-source">
                    <small>DATABASE COLUMN</small>
                    <strong>{source}</strong>
                  </div>

                  <span className="oi-arrow">→</span>

                  <div className="oi-target">
                    <small>GOGREEN POS FIELD</small>

                    <select
                      value={mapping[source] || ''}
                      disabled={saving || importing}
                      onChange={event =>
                        updateMapping(source, event.target.value)
                      }
                    >
                      <option value="">Skip This Column</option>

                      {standardFields.map(field => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}

                      <option value="__custom__">
                        + Create Custom Field
                      </option>
                    </select>

                    {mapping[source] === '__custom__' && (
                      <select
                        className="oi-type-select"
                        value={customTypes[source] || 'text'}
                        disabled={saving || importing}
                        onChange={event => {
                          setCustomTypes(previous => ({
                            ...previous,
                            [source]: event.target.value
                          }));
                          setSuccess('');
                        }}
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="boolean">Yes / No</option>
                        <option value="image">Image Reference</option>
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="oi-actions">
              <button
                className="oi-save-btn"
                type="button"
                disabled={saving || importing || loading}
                onClick={saveMappingOnly}
              >
                {saving ? 'Saving...' : 'Save Column Mapping Only'}
              </button>

              <button
                className="oi-save-btn"
                type="button"
                disabled={
                  saving ||
                  importing ||
                  loading ||
                  !allRows.length
                }
                onClick={saveAndImport}
              >
                {importing
                  ? `Importing ${importProgress}/${allRows.length}...`
                  : saving
                    ? 'Saving Mapping...'
                    : `Save Mapping & Import ${allRows.length} Products`}
              </button>
            </div>

            <p>
              Saving and importing uses the same selected file.
              You do not need to upload it twice.
            </p>
          </div>
        </>
      )}

      {savedMapping && (
        <div className="oi-card">
          <h3>Saved Business Mapping</h3>
          <p>
            Your business has a saved mapping.
            Upload a file to review or update it.
          </p>

          <div className="oi-saved">
            {savedMapping.mappings?.map(item => (
              <span key={`${item.source}-${item.target}`}>
                {item.source} → {item.target}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="oi-notice">
        <strong>Important:</strong> Product images are optional.
        Local image filenames are not uploaded yet.
        Existing products with duplicate SKUs are skipped.
        After importing, open Products & Inventory to see
        your imported products.
      </div>
    </div>
  );
}
