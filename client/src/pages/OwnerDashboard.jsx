
import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import OwnerProducts from './OwnerProducts';
import OwnerImport from './OwnerImport';
import OwnerBilling from './OwnerBilling';
import OwnerReceipts from './OwnerReceipts';
import OwnerSubscription from './OwnerSubscription';
import OwnerReturns from './OwnerReturns';
import OwnerReports from './OwnerReports';
import OwnerEmployees from './OwnerEmployees';
import OwnerPromotions from './OwnerPromotions';
import './OwnerDashboard.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const money = n => `Rs. ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

const menuItems = [
    { id: 'overview', label: 'Overview', icon: '▦' },
    { id: 'billing', label: 'Billing / POS', icon: '▣' },
    { id: 'products', label: 'Products & Inventory', icon: '◈' },
    { id: 'receipts', label: 'Digital Receipts', icon: '▤' },
    { id: 'subscription', label: 'My Subscription', icon: '◷' },
    { id: 'returns', label: 'Returns & Refunds', icon: '↩' },
    { id: 'reports', label: 'Reports & Analytics', icon: '▥' },
    { id: 'employees', label: 'Employees', icon: '♙' },
    { id: 'offers', label: 'Offers & Targets', icon: '★' },
    { id: 'import', label: 'Import Existing Data', icon: '⇧' },
    { id: 'settings', label: 'Settings', icon: '⚙' }
];

const quickActions = [
    {
        id: 'billing',
        title: 'Create New Sale',
        description: 'Generate invoices and process customer sales.',
        icon: '▣'
    },
    {
        id: 'products',
        title: 'Manage Products',
        description: 'Add products, update pricing and track inventory.',
        icon: '◈'
    },
    {
        id: 'receipts',
        title: 'Digital Receipts',
        description: 'View, share and scan QR-linked digital receipts.',
        icon: '▤'
    },
    {
        id: 'import',
        title: 'Import Products',
        description: 'Import CSV and Excel products into your inventory.',
        icon: '⇧'
    }
];

function formatDate(value) {
    if (!value) return 'Not available';

    try {
        const date = value.toDate ? value.toDate() : new Date(value);
        return date.toLocaleDateString('en-PK', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    } catch {
        return 'Not available';
    }
}

export default function OwnerDashboard({ profile }) {
    const [business, setBusiness] = useState(null);
    const [overview, setOverview] = useState(null);
    const [overviewError, setOverviewError] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activePage, setActivePage] = useState('overview');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    useEffect(() => {
        let active = true;

        async function loadBusiness() {
            if (!profile?.businessId) {
                setError('No business is assigned to your account.');
                setLoading(false);
                return;
            }

            try {
                const businessRef = doc(
                    db,
                    'businesses',
                    profile.businessId
                );

                const snapshot = await getDoc(businessRef);

                if (!active) return;

                if (!snapshot.exists()) {
                    throw new Error('Assigned business not found.');
                }

                const data = snapshot.data();

                if (
                    data.ownerUid !== auth.currentUser?.uid ||
                    data.status !== 'active'
                ) {
                    throw new Error(
                        'You do not have access to this business.'
                    );
                }

                setBusiness({
                    id: snapshot.id,
                    ...data
                });
            } catch (err) {
                if (active) {
                    console.error('Owner business error:', err);
                    setError(
                        err.code === 'permission-denied'
                            ? 'Business access is blocked by Firestore rules.'
                            : err.message
                    );
                }
            } finally {
                if (active) setLoading(false);
            }
        }

        loadBusiness();

        return () => {
            active = false;
        };
    }, [profile?.businessId]);

    useEffect(() => {
        if (activePage !== 'overview' || !business) return;
        let alive = true;
        async function loadOverview() {
            try {
                const user = auth.currentUser;
                if (!user) throw new Error('Please login again.');
                const response = await fetch(`${API_URL}/api/owner/billing/overview`, {
                    headers: { Authorization: `Bearer ${await user.getIdToken()}` }
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.message || 'Overview failed.');
                if (alive) { setOverview(data.stats); setOverviewError(''); }
            } catch (err) { if (alive) setOverviewError(err.message); }
        }
        loadOverview();
        return () => { alive = false; };
    }, [activePage, business]);

    function navigateTo(page) {
        setActivePage(page);
        setSidebarOpen(false);
    }

    const selectedMenu = menuItems.find(
        item => item.id === activePage
    );

    if (loading) {
        return (
            <div className="owner-loading">
                <div className="spinner-border text-success" />
                <p>Loading your business workspace...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="owner-loading">
                <div className="owner-error-card">
                    <h3>Unable to Open Business</h3>
                    <p>{error}</p>
                    <button
                        className="btn btn-outline-danger"
                        onClick={() => signOut(auth)}
                    >
                        Logout
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="owner-app">
            {sidebarOpen && (
                <div
                    className="owner-overlay"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <aside
                className={`owner-sidebar ${sidebarOpen ? 'owner-sidebar-open' : ''
                    } ${sidebarCollapsed ? 'owner-sidebar-collapsed' : ''
                    }`}
            >
                <div className="owner-brand">
                    <div className="owner-brand-icon">G.</div>
                    <div>
                        <strong>GoGreen POS</strong>
                        <span>BUSINESS WORKSPACE</span>
                    </div>
                    <button
                        type="button"
                        className="owner-collapse-btn"
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {sidebarCollapsed ? '»' : '«'}
                    </button>
                </div>

                <div className="owner-business-switcher">
                    <div className="owner-business-avatar">
                        {business.name?.charAt(0)?.toUpperCase() || 'B'}
                    </div>
                    <div className="owner-business-info">
                        <strong title={business.name}>
                            {business.name}
                        </strong>
                        <span>{business.type}</span>
                    </div>
                    <span className="owner-active-dot" />
                </div>

                <div className="owner-menu-label">
                    WORKSPACE
                </div>

                <nav className="owner-navigation">
                    {menuItems.map(item => (
                        <button
                            type="button"
                            key={item.id}
                            title={item.label}
                            className={`owner-nav-item ${activePage === item.id
                                ? 'owner-nav-active'
                                : ''
                                }`}
                            onClick={() => navigateTo(item.id)}
                        >
                            <span className="owner-nav-icon">
                                {item.icon}
                            </span>
                            <span>{item.label}</span>
                            {activePage === item.id && (
                                <span className="owner-nav-indicator" />
                            )}
                        </button>
                    ))}
                </nav>

                <div className="owner-sidebar-footer">
                    <div className="owner-plan-box">
                        <span>Current Subscription</span>
                        <strong>{business.plan || 'Basic'} Plan</strong>
                        <small>
                            Managed by GoGreen POS
                        </small>
                    </div>

                    <button
                        type="button"
                        className="owner-logout"
                        onClick={() => signOut(auth)}
                    >
                        <span>↪</span> Logout
                    </button>
                </div>
            </aside>

            <div className="owner-main-area">
                <header className="owner-topbar">
                    <div className="owner-topbar-left">
                        <button
                            type="button"
                            className="owner-mobile-menu"
                            onClick={() => setSidebarOpen(true)}
                            aria-label="Open menu"
                        >
                            ☰
                        </button>

                        <div>
                            <span className="owner-breadcrumb">
                                Workspace / {selectedMenu?.label}
                            </span>
                            <h2>{selectedMenu?.label}</h2>
                        </div>
                    </div>

                    <div className="owner-topbar-right">
                        <span className="owner-status">
                            <span /> Business Active
                        </span>
                        <div className="owner-profile-avatar">
                            {business.ownerName?.charAt(0)?.toUpperCase() || 'O'}
                        </div>
                        <div className="owner-topbar-profile">
                            <strong>{business.ownerName}</strong>
                            <span>Business Owner</span>
                        </div>
                    </div>
                </header>

                <main className="owner-content">
                    {activePage === 'billing' ? (
                        <OwnerBilling business={business} />
                    ) : activePage === 'subscription' ? (
                        <OwnerSubscription />
                    ) : activePage === 'employees' ? (<OwnerEmployees />) : activePage === 'offers' ? (<OwnerPromotions />) : activePage === 'reports' ? (
                        <OwnerReports />
                    ) : activePage === 'returns' ? (
                        <OwnerReturns />
                    ) : activePage === 'receipts' ? (
                        <OwnerReceipts business={business} />
                    ) : activePage === 'import' ? (
                        <OwnerImport />
                    ) :
                        activePage === 'products' ? (
                            <OwnerProducts
                                onBack={() => navigateTo('overview')}
                            />
                        ) : activePage === 'overview' ? (
                            <>
                                <section className="owner-welcome">
                                    <div>
                                        <span className="owner-welcome-label">
                                            YOUR BUSINESS OVERVIEW
                                        </span>
                                        <h1>
                                            Welcome back, {business.ownerName?.split(' ')[0]}!
                                        </h1>
                                        <p>
                                            Manage {business.name} from one centralized
                                            workspace.
                                        </p>
                                    </div>
                                    <span className="owner-welcome-badge">
                                        {business.plan || 'Basic'} Plan
                                    </span>
                                </section>

                                {overviewError && <p style={{color:'#b42318'}}>Overview: {overviewError}</p>}
                                <div className="owner-stats-grid">
                                    {[
                                        { label: 'Total Revenue', value: overview ? money(overview.revenue) : '...', icon: '₨', note: 'Completed sales' },
                                        { label: 'Total Sales', value: overview?.totalSales ?? '...', icon: '▣', note: 'Completed transactions' },
                                        { label: 'Total Products', value: overview?.totalProducts ?? '...', icon: '◈', note: 'Inventory products' },
                                        { label: 'Low Stock Alerts', value: overview?.lowStock ?? '...', icon: '!', note: 'Products below alert threshold' },
                                        { label: 'Cost of Goods', value: overview ? money(overview.costOfGoods) : '...', icon: '₨', note: `Recorded cost for ${overview?.profitSales ?? 0} sales` },
                                        { label: 'Gross Profit', value: overview ? money(overview.grossProfit) : '...', icon: '↗', note: `Before expenses; ${overview?.profitSales ?? 0} sales with cost data` },
                                        { label: 'Digital Receipts', value: overview?.digitalReceipts ?? '...', icon: '▤', note: 'QR-enabled receipt records' },
                                        { label: 'Paper Saved (Estimate)', value: overview?.paperSheetsAvoidedEstimate ?? '...', icon: '♧', note: 'Assumes one paper receipt avoided per sale; not measured CO₂' }
                                    ].map(stat => (
                                        <div className="owner-stat-card" key={stat.label}>
                                            <div className="owner-stat-top"><span>{stat.label}</span><div className="owner-stat-icon">{stat.icon}</div></div>
                                            <h2>{stat.value}</h2><p>{stat.note}</p>
                                        </div>
                                    ))}
                                </div>

                                <section className="owner-section">
                                    <div className="owner-section-heading">
                                        <div>
                                            <h3>Quick Actions</h3>
                                            <p>
                                                Your frequently used business tools.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="owner-actions-grid">
                                        {quickActions.map(action => (
                                            <button
                                                type="button"
                                                key={action.id}
                                                className="owner-action-card"
                                                onClick={() => navigateTo(action.id)}
                                            >
                                                <div className="owner-action-icon">
                                                    {action.icon}
                                                </div>
                                                <h4>{action.title}</h4>
                                                <p>{action.description}</p>
                                                <span>Open Module →</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>

                                <div className="owner-bottom-grid">
                                    <section className="owner-section owner-info-panel">
                                        <div className="owner-section-heading">
                                            <div>
                                                <h3>Business Information</h3>
                                                <p>Your registered business details.</p>
                                            </div>
                                        </div>

                                        <div className="owner-info-row">
                                            <span>Business Name</span>
                                            <strong>{business.name}</strong>
                                        </div>
                                        <div className="owner-info-row">
                                            <span>Business Type</span>
                                            <strong>{business.type}</strong>
                                        </div>
                                        <div className="owner-info-row">
                                            <span>Owner Email</span>
                                            <strong>{profile.email}</strong>
                                        </div>
                                        <div className="owner-info-row">
                                            <span>Phone</span>
                                            <strong>{business.phone || 'Not provided'}</strong>
                                        </div>
                                        <div className="owner-info-row">
                                            <span>Registered On</span>
                                            <strong>{formatDate(business.createdAt)}</strong>
                                        </div>
                                    </section>

                                    <section className="owner-section owner-activity-panel">
                                        <div className="owner-section-heading">
                                            <div>
                                                <h3>Recent Activity</h3>
                                                <p>Sales and inventory activity.</p>
                                            </div>
                                        </div>

                                        <div className="owner-empty-activity">
                                            <div className="owner-empty-icon">▤</div>
                                            <h4>No activity yet</h4>
                                            <p>
                                                Your sales and inventory activity will
                                                appear here once those modules are enabled.
                                            </p>
                                        </div>
                                    </section>
                                </div>
                            </>
                        ) : (
                            <section className="owner-module-placeholder">
                                <div className="owner-module-icon">
                                    {selectedMenu?.icon}
                                </div>
                                <span className="owner-module-label">
                                    GOGREEN POS MODULE
                                </span>
                                <h2>{selectedMenu?.label}</h2>
                                <p>
                                    This module is being prepared for your
                                    business. Its data will be linked to
                                    your assigned business account.
                                </p>

                                {activePage === 'import' && (
                                    <div className="owner-import-note">
                                        <strong>Planned import support</strong>
                                        <p>
                                            CSV and Excel product files, image ZIP
                                            uploads and database migration mapping.
                                            Imports are not enabled yet.
                                        </p>
                                    </div>
                                )}

                                <button
                                    type="button"
                                    className="owner-back-button"
                                    onClick={() => navigateTo('overview')}
                                >
                                    ← Back to Overview
                                </button>
                            </section>
                        )}
                </main>
            </div>
        </div>
    );
}
