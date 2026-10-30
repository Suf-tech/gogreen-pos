
import { useEffect, useState } from 'react';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    runTransaction,
    serverTimestamp
} from 'firebase/firestore';
import { auth, db } from '../firebase';

function generateSlug(name) {
    return name
        .toLowerCase()
        .trim()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const initialForm = {
    name: '',
    type: '',
    ownerName: '',
    ownerEmail: '',
    phone: '',
    address: '',
    plan: 'Basic'
};

export default function Businesses() {
    const [form, setForm] = useState(initialForm);
    const [businesses, setBusinesses] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editingBusiness, setEditingBusiness] = useState(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [copiedId, setCopiedId] = useState(null);
    const [receiptCounts, setReceiptCounts] = useState({});
    const [receiptLoading, setReceiptLoading] = useState(false);
    const [receiptError, setReceiptError] = useState('');

    const loadBusinesses = async () => {
        setLoading(true);

        try {
            const snapshot = await getDocs(collection(db, 'businesses'));
            const data = snapshot.docs.map((item) => ({
                id: item.id,
                ...item.data()
            }));

            data.sort(
                (a, b) =>
                    (b.createdAt?.seconds || 0) -
                    (a.createdAt?.seconds || 0)
            );

            setBusinesses(data);
            // Read receipt totals from the same protected API used by the Dashboard.
            await loadReceiptCounts();
        } catch (err) {
            console.error(err);
            setError('Unable to load businesses.');
        } finally {
            setLoading(false);
        }
    };

    const loadReceiptCounts = async () => {
        setReceiptLoading(true);
        setReceiptError('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please sign in again.');
            const api = import.meta.env.VITE_API_URL || 'http://localhost:5000';
            const response = await fetch(`${api}/api/admin/analytics/overview`, {
                headers: { Authorization: `Bearer ${await user.getIdToken()}` },
                cache: 'no-store'
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load receipt counts.');
            setReceiptCounts(Object.fromEntries(data.businesses.map(b => [b.id, Number(b.receipts || 0)])));
        } catch (err) {
            setReceiptError(`Receipt counts could not be loaded: ${err.message}`);
        } finally {
            setReceiptLoading(false);
        }
    };

    useEffect(() => {
        loadBusinesses();
    }, []);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setForm((previous) => ({ ...previous, [name]: value }));
    };

    const resetForm = () => {
        setForm(initialForm);
        setEditingBusiness(null);
        setShowForm(false);
    };

    const openEdit = (business) => {
        setEditingBusiness(business);
        setForm({
            name: business.name || '',
            type: business.type || '',
            ownerName: business.ownerName || '',
            ownerEmail: business.ownerEmail || '',
            phone: business.phone || '',
            address: business.address || '',
            plan: business.plan || 'Basic'
        });
        setError('');
        setSuccess('');
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (saving) return;

        setSaving(true);
        setError('');
        setSuccess('');

        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');

            const slug = generateSlug(form.name);
            if (!slug || slug.length > 100) {
                throw new Error('Enter a valid business name (URL max 100 characters).');
            }

            const businessRef = editingBusiness
                ? doc(db, 'businesses', editingBusiness.id)
                : doc(collection(db, 'businesses'));

            await runTransaction(db, async (transaction) => {
                const existingBusiness = editingBusiness
                    ? await transaction.get(businessRef)
                    : null;

                if (editingBusiness && !existingBusiness.exists()) {
                    throw new Error('Business no longer exists.');
                }

                const oldSlug = existingBusiness?.data()?.slug || '';
                const newSlugRef = doc(db, 'businessSlugs', slug);
                const oldSlugRef = oldSlug
                    ? doc(db, 'businessSlugs', oldSlug)
                    : null;

                const newSlugDoc = await transaction.get(newSlugRef);

                if (
                    newSlugDoc.exists() &&
                    newSlugDoc.data().businessId !== businessRef.id
                ) {
                    throw new Error('This business URL is already taken.');
                }

                if (editingBusiness && existingBusiness.data().ownerUid &&
                    form.ownerEmail.trim().toLowerCase() !== existingBusiness.data().ownerEmail) {
                    throw new Error('Owner login email cannot be changed after account creation.');
                }

                const details = {
                    name: form.name.trim(),
                    slug,
                    type: form.type.trim(),
                    ownerName: form.ownerName.trim(),
                    ownerEmail: form.ownerEmail.trim().toLowerCase(),
                    phone: form.phone.trim(),
                    address: form.address.trim(),
                    plan: form.plan
                };

                if (editingBusiness) {
                    transaction.update(businessRef, {
                        ...details,
                        status: existingBusiness.data().status === 'disabled'
                            ? 'disabled'
                            : 'active'
                    });

                } else {
                    transaction.set(businessRef, {
                        ...details,
                        status: 'active',
                        createdAt: serverTimestamp(),
                        createdBy: user.uid
                    });
                }

                if (!newSlugDoc.exists()) {
                    transaction.set(newSlugRef, {
                        businessId: businessRef.id,
                        createdBy: user.uid,
                        createdAt: serverTimestamp()
                    });
                }

                if (oldSlugRef && oldSlug !== slug) {
                    transaction.delete(oldSlugRef);
                }
            });

            const wasEditing = Boolean(editingBusiness);
            resetForm();
            setSuccess(
                wasEditing
                    ? 'Business updated successfully!'
                    : 'Business registered successfully!'
            );
            await loadBusinesses();
        } catch (err) {
            console.error(err);
            console.log('Firebase error code:', err.code);
            console.log('Firebase error message:', err.message);
            setError(
                (err.message === 'This business URL is already taken.' ||
                 err.message === 'Owner login email cannot be changed after account creation.')
                    ? err.message
                    : err.message?.startsWith('Enter a valid business name')
                        ? err.message
                        : 'Unable to save business. Check Firestore permissions.'
            );
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (business) => {
        const nextStatus =
            business.status === 'active' ? 'disabled' : 'active';

        setBusyId(business.id);
        setError('');
        setSuccess('');

        try {
            await runTransaction(db, async (transaction) => {
                const businessRef = doc(db, 'businesses', business.id);
                const snapshot = await transaction.get(businessRef);

                if (!snapshot.exists()) {
                    throw new Error('Business not found');
                }

                const data = snapshot.data();

                if (!data.slug) {
                    throw new Error('Generate a POS link using Edit first.');
                }

                transaction.update(businessRef, {
                    status: nextStatus
                });
            });

            setSuccess(`Business ${nextStatus} successfully.`);
            await loadBusinesses();
        } catch (err) {
            console.error(err);
            setError(err.message || 'Unable to change status.');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (business) => {
        if (business.ownerUid) {
            setError('This business has an owner account. Disable it for now; account cleanup must be implemented before deletion.');
            return;
        }
        const confirmed = window.confirm(
            `Permanently delete "${business.name}"?\n\nThis action cannot be undone.`
        );

        if (!confirmed) return;

        setBusyId(business.id);
        setError('');
        setSuccess('');

        try {
            await runTransaction(db, async (transaction) => {
                const businessRef = doc(db, 'businesses', business.id);
                const businessSnap = await transaction.get(businessRef);

                if (!businessSnap.exists()) {
                    throw new Error('Business not found.');
                }

                const slug = businessSnap.data().slug;

                if (slug) {
                    const slugRef = doc(db, 'businessSlugs', slug);
                    const slugSnap = await transaction.get(slugRef);

                    if (slugSnap.exists()) {
                        transaction.delete(slugRef);
                    }
                }

                transaction.delete(businessRef);
            });

            setSuccess('Business deleted successfully.');
            await loadBusinesses();
        } catch (err) {
            console.error(err);
            setError('Unable to delete business.');
        } finally {
            setBusyId(null);
        }
    };


    const handleCopyLink = async (business) => {
        if (!business.slug) return;

        try {
            const url = `${window.location.origin}/pos/${business.slug}`;
            await navigator.clipboard.writeText(url);
            setCopiedId(business.id);
        } catch (err) {
            console.error(err);
            setError('Unable to copy POS link.');
        }
    };

    return (
        <div className="business-page">
            {receiptError && <div className="alert alert-danger" role="alert">{receiptError}</div>}
            <button type="button" className="btn btn-outline-success btn-sm mb-3" onClick={loadReceiptCounts} disabled={receiptLoading}>{receiptLoading ? "Loading receipts..." : "↻ Refresh Receipt Counts"}</button>
            <div className="business-page-header">
                <div>
                    <h2>Business Management</h2>
                    <p>Register and manage businesses on GoGreen POS.</p>
                </div>

                <button
                    className="primary-action"
                    onClick={() => {
                        if (showForm) {
                            resetForm();
                        } else {
                            setEditingBusiness(null);
                            setForm(initialForm);
                            setShowForm(true);
                        }
                        setError('');
                        setSuccess('');
                    }}
                >
                    {showForm ? 'Cancel' : '+ Register Business'}
                </button>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            {showForm && (
                <div className="dashboard-panel business-form-panel">
                    <h3>
                        {editingBusiness ? 'Edit Business' : 'Register New Business'}
                    </h3>

                    <p className="text-secondary small">
                        {editingBusiness
                            ? 'Update business information and POS URL.'
                            : 'Register a new business on GoGreen POS.'}
                    </p>

                    <form onSubmit={handleSubmit}>
                        <div className="row g-3">
                            <div className="col-md-6">
                                <label className="form-label">Business Name *</label>
                                <input
                                    className="form-control"
                                    name="name"
                                    value={form.name}
                                    onChange={handleChange}
                                    maxLength={120}
                                    required
                                />
                            </div>

                            <div className="col-md-6">
                                <label className="form-label">Business Type *</label>
                                <input
                                    className="form-control"
                                    name="type"
                                    value={form.type}
                                    onChange={handleChange}
                                    placeholder="e.g. Pharmacy, Grocery, Hardware"
                                    maxLength={80}
                                    required
                                />
                            </div>

                            <div className="col-12">
                                <label className="form-label">POS URL</label>
                                <div className="input-group">
                                    <span className="input-group-text">/pos/</span>
                                    <input
                                        className="form-control"
                                        value={generateSlug(form.name)}
                                        readOnly
                                    />
                                </div>
                                <small className="text-secondary">
                                    The URL changes automatically when the business name changes.
                                </small>
                            </div>

                            <div className="col-md-6">
                                <label className="form-label">Owner Name *</label>
                                <input
                                    className="form-control"
                                    name="ownerName"
                                    value={form.ownerName}
                                    onChange={handleChange}
                                    required
                                />
                            </div>

                            <div className="col-md-6">
                                <label className="form-label">Owner Email *</label>
                                <input
                                    type="email"
                                    className="form-control"
                                    name="ownerEmail"
                                    value={form.ownerEmail}
                                    onChange={handleChange}
                                    maxLength={254}
                                    required
                                />
                            </div>

                            <div className="col-md-6">
                                <label className="form-label">Phone Number *</label>
                                <input
                                    type="tel"
                                    className="form-control"
                                    name="phone"
                                    value={form.phone}
                                    onChange={handleChange}
                                    required
                                />
                            </div>

                            <div className="col-md-6">
                                <label className="form-label">Subscription Plan</label>
                                <select
                                    className="form-select"
                                    name="plan"
                                    value={form.plan}
                                    onChange={handleChange}
                                >
                                    <option>Basic</option>
                                    <option>Standard</option>
                                    <option>Premium</option>
                                </select>
                            </div>

                            <div className="col-12">
                                <label className="form-label">Business Address *</label>
                                <textarea
                                    className="form-control"
                                    name="address"
                                    value={form.address}
                                    onChange={handleChange}
                                    rows={3}
                                    required
                                />
                            </div>
                        </div>

                        <div className="mt-4 d-flex gap-2">
                            <button
                                className="primary-action"
                                type="submit"
                                disabled={saving}
                            >
                                {saving
                                    ? 'Saving...'
                                    : editingBusiness
                                        ? 'Save Changes'
                                        : 'Register Business'}
                            </button>

                            <button
                                type="button"
                                className="btn btn-light"
                                disabled={saving}
                                onClick={resetForm}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="dashboard-panel business-list-panel">
                <div className="panel-heading">
                    <div>
                        <h3>Registered Businesses</h3>
                        <p>Businesses registered on your platform.</p>
                    </div>
                    <span className="business-count">
                        {businesses.length} Total
                    </span>
                </div>

                {loading ? (
                    <p className="text-secondary mt-4">Loading businesses...</p>
                ) : businesses.length === 0 ? (
                    <div className="empty-state">
                        <h4>No businesses registered yet</h4>
                    </div>
                ) : (
                    <div className="table-responsive mt-4">
                        <table className="table align-middle">
                            <thead>
                                <tr>
                                    <th>Business</th>
                                    <th>Owner</th>
                                    <th>Type</th>
                                    <th>Plan</th>
                                    <th>Status</th>
                                    <th>POS Link</th>
                                    <th>Total Receipts</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>

                            <tbody>
                                {businesses.map((business) => (
                                    <tr key={business.id}>
                                        <td className="fw-semibold">
                                            {business.name}
                                        </td>

                                        <td>
                                            {business.ownerName}
                                            <div className="small text-secondary">
                                                {business.ownerEmail}
                                            </div>
                                        </td>

                                        <td>{business.type}</td>
                                        <td>{business.plan}</td>

                                        <td>
                                            <span
                                                className={`badge ${business.status === 'active'
                                                        ? 'text-bg-success'
                                                        : business.status === 'disabled'
                                                            ? 'text-bg-secondary'
                                                            : 'text-bg-warning'
                                                    }`}
                                            >
                                                {business.status}
                                            </span>
                                        </td>

                                        <td>
                                            {business.slug ? (
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-outline-success"
                                                    onClick={() => handleCopyLink(business)}
                                                >
                                                    {copiedId === business.id
                                                        ? 'Copied!'
                                                        : 'Copy Link'}
                                                </button>
                                            ) : (
                                                <span className="text-secondary small">
                                                    Not generated
                                                </span>
                                            )}
                                        </td>
                                        <td className="fw-semibold">{(receiptCounts[business.id] ?? 0).toLocaleString()}</td>

                                        <td>
                                            <div className="d-flex gap-2 align-items-center">
                                                <button
                                                    className="btn btn-sm btn-outline-primary"
                                                    onClick={() => openEdit(business)}
                                                    disabled={busyId === business.id}
                                                >
                                                    Edit
                                                </button>

                                                <button
                                                    className="btn btn-sm btn-outline-danger"
                                                    onClick={() => handleDelete(business)}
                                                    disabled={busyId === business.id || Boolean(business.ownerUid)}
                                                    title={business.ownerUid ? "Disable this business instead; owner account is linked" : "Delete business"}
                                                >
                                                    Delete
                                                </button>

                                                <div className="form-check form-switch ms-1">
                                                    <input
                                                        className="form-check-input"
                                                        type="checkbox"
                                                        role="switch"
                                                        title={
                                                            business.status === 'active'
                                                                ? 'Disable business'
                                                                : 'Activate business'
                                                        }
                                                        checked={business.status === 'active'}
                                                        disabled={busyId === business.id}
                                                        onChange={() => handleToggle(business)}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
