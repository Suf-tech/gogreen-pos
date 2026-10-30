import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../firebase';
import './OwnerBilling.css';
import ReceiptCard from './ReceiptCard';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const money = n => `Rs. ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2, 16)}`);

export default function OwnerBilling({ business }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [discount, setDiscount] = useState('0');
  const [received, setReceived] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const requestId = useRef(newId());
  const searchRef = useRef(null);

  const request = useCallback(async (path, options = {}) => {
    if (!auth.currentUser) throw new Error('Please login again.');
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || 'Request failed.');
    return data;
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/api/owner/products/');
      setProducts(data.products || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.filter(p => Number(p.stock) > 0).slice(0, 40);
    return products.filter(p => [p.name, p.sku, p.barcode].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 40);
  }, [products, search]);

  const subtotal = round(cart.reduce((sum, item) => sum + Number(item.sellingPrice) * item.quantity, 0));
  const discountAmount = Number(discount || 0);
  const total = round(Math.max(0, subtotal - (Number.isFinite(discountAmount) ? discountAmount : 0)));
  const receivedAmount = Number(received || 0);
  const change = round(Math.max(0, receivedAmount - total));
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);

  function addProduct(product) {
    setError('');
    setReceipt(null);
    const stock = Number(product.stock);
    if (stock <= 0) return setError('Product is out of stock.');
    setCart(old => {
      const current = old.find(item => item.id === product.id);
      if (current) {
        if (current.quantity >= stock) {
          setError(`Only ${stock} units available.`);
          return old;
        }
        return old.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...old, { ...product, quantity: 1 }];
    });
    setSearch('');
    searchRef.current?.focus();
  }

  function updateQuantity(id, next) {
    const product = products.find(p => p.id === id);
    const value = Number(next);
    if (!Number.isSafeInteger(value) || value < 1) return;
    if (value > Number(product?.stock || 0)) {
      setError(`Available stock: ${product?.stock || 0}`);
      return;
    }
    setError('');
    setCart(old => old.map(item => item.id === id ? { ...item, quantity: value } : item));
  }

  function resetSale() {
    setCart([]);
    setDiscount('0');
    setReceived('');
    setCustomerName('');
    setCustomerPhone('');
    setReceipt(null);
    setError('');
    requestId.current = newId();
  }

  async function checkout() {
    if (saving || !cart.length) return;
    setError('');
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) return setError('Enter a valid discount.');
    if (!Number.isFinite(receivedAmount) || receivedAmount < total) return setError('Cash received must cover the total.');
    setSaving(true);
    try {
      const result = await request('/api/owner/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          requestId: requestId.current,
          items: cart.map(item => ({ productId: item.id, quantity: item.quantity })),
          discount: round(discountAmount),
          received: round(receivedAmount),
          customerName,
          customerPhone
        })
      });
      setReceipt(result.sale);
      setCart([]);
      setDiscount('0');
      setReceived('');
      setCustomerName('');
      setCustomerPhone('');
      requestId.current = newId();
      await loadProducts();
    } catch (err) {
      setError(`${err.message} If the network failed, retry checkout without changing the cart.`);
    } finally {
      setSaving(false);
    }
  }

  function handleSearchKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const exact = products.find(p => Number(p.stock) > 0 && [p.barcode, p.sku].some(v => String(v || '').toLowerCase() === search.trim().toLowerCase()));
    if (exact) addProduct(exact);
    else if (matches.length === 1 && Number(matches[0].stock) > 0) addProduct(matches[0]);
    else setError('Select a matching product from the list.');
  }

  return (
    <div className="pos-page">
      <div className="pos-heading">
        <div><span className="pos-eyebrow">SALES COUNTER</span><h1>Billing / POS</h1><p>Search or scan products, collect cash and issue a receipt.</p></div>
        <button className="pos-secondary" onClick={loadProducts} disabled={loading || saving}>↻ Refresh Inventory</button>
      </div>
      {error && <div className="pos-alert" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
      <div className="pos-layout">
        <section className="pos-panel">
          <div className="pos-panel-head"><h3>Find Products</h3><span>{products.length} loaded</span></div>
          <input ref={searchRef} className="pos-search" type="search" placeholder="Search name, SKU or scan barcode..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearchKeyDown} autoFocus />
          <p className="pos-hint">Barcode scanner: scan into the search box and press Enter.</p>
          {loading ? <p>Loading inventory...</p> : <div className="pos-products">
            {matches.length === 0 ? <p>No matching products found.</p> : matches.map(product => (
              <button type="button" key={product.id} className="pos-product" disabled={Number(product.stock) <= 0 || saving} onClick={() => addProduct(product)}>
                <span className="pos-product-icon">{product.name?.[0]?.toUpperCase() || 'P'}</span>
                <span className="pos-product-info"><strong>{product.name}</strong><small>{product.sku} · Stock: {product.stock}</small></span>
                <strong>{money(product.sellingPrice)}</strong><span className="pos-add">+</span>
              </button>
            ))}
          </div>}
        </section>
        <section className="pos-panel">
          <div className="pos-panel-head"><h3>Current Sale</h3><span>{quantity} item(s)</span></div>
          {!cart.length ? <div className="pos-empty">Add products to begin a new sale.</div> : <div className="pos-cart">
            {cart.map(item => <div className="pos-cart-item" key={item.id}>
              <div className="pos-cart-info"><strong>{item.name}</strong><small>{money(item.sellingPrice)} each</small></div>
              <div className="pos-qty"><button type="button" disabled={saving} onClick={() => item.quantity === 1 ? setCart(old => old.filter(p => p.id !== item.id)) : updateQuantity(item.id, item.quantity - 1)}>−</button><input aria-label={`Quantity for ${item.name}`} type="number" min="1" max={item.stock} value={item.quantity} disabled={saving} onChange={e => updateQuantity(item.id, e.target.value)} /><button type="button" disabled={saving} onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button></div>
              <strong>{money(item.quantity * item.sellingPrice)}</strong>
              <button type="button" className="pos-remove" disabled={saving} onClick={() => setCart(old => old.filter(p => p.id !== item.id))}>×</button>
            </div>)}
          </div>}
          <div className="pos-fields">
            <label>Customer Name (optional)<input value={customerName} maxLength={120} onChange={e => setCustomerName(e.target.value)} placeholder="Walk-in customer" /></label>
            <label>Customer Phone (optional)<input value={customerPhone} maxLength={40} onChange={e => setCustomerPhone(e.target.value)} placeholder="03xxxxxxxxx" /></label>
          </div>
          <div className="pos-totals">
            <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            <label className="pos-amount-row"><span>Discount (Rs.)</span><input type="number" min="0" max={subtotal} step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} /></label>
            <div className="pos-grand"><span>Total</span><strong>{money(total)}</strong></div>
            <label className="pos-amount-row"><span>Cash Received</span><input type="number" min="0" step="0.01" value={received} onChange={e => setReceived(e.target.value)} placeholder="0.00" /></label>
            <div><span>Change to Return</span><strong>{money(change)}</strong></div>
          </div>
          <div className="pos-actions"><button type="button" className="pos-secondary" disabled={saving} onClick={resetSale}>Clear Sale</button><button type="button" className="pos-primary" disabled={saving || !cart.length} onClick={checkout}>{saving ? 'Processing...' : `Complete Cash Sale · ${money(total)}`}</button></div>
        </section>
      </div>
      {receipt && <ReceiptCard sale={receipt} business={business} onClose={() => setReceipt(null)} />}
    </div>
  );
}
