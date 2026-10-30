
import { useState, useEffect, useCallback } from 'react';
import { signOut } from 'firebase/auth';
import {
  onSnapshot,
  collection
} from 'firebase/firestore';

import { auth, db } from '../firebase';
import Businesses from './Businesses';
import AdminSubscriptions from './AdminSubscriptions';
import Analytics from './Analytics';
import AdminPromotions from './AdminPromotions';
import './AdminDashboard.css';

const menuItems = [
  { icon: '▦', label: 'Dashboard' },
  { icon: '▣', label: 'Businesses' },
  { icon: '◷', label: 'Subscriptions' },
  { icon: '★', label: 'Campaigns' },
  { icon: '▥', label: 'Analytics' },
  { icon: '⚙', label: 'Settings' }
];

const formatNumber = (value) =>
  Number(value || 0).toLocaleString('en-US');

export default function AdminDashboard() {
  const [activePage, setActivePage] = useState('Dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('gogreen-sidebar-collapsed') === 'true';
  });

  const [businesses, setBusinesses] = useState([]);
  const [receiptCounts, setReceiptCounts] = useState({});
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');
  const [receiptError, setReceiptError] = useState('');

  // =====================================
  // 1. Save Sidebar Preference
  // =====================================

  useEffect(() => {
    localStorage.setItem(
      'gogreen-sidebar-collapsed',
      String(collapsed)
    );
  }, [collapsed]);

  // =====================================
  // 2. Load Registered Businesses
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'businesses'),
      (snapshot) => {
        const records = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }));

        records.sort(
          (a, b) =>
            (b.createdAt?.seconds || 0) -
            (a.createdAt?.seconds || 0)
        );

        setBusinesses(records);
        setStatsLoading(false);
        setStatsError('');
      },
      (error) => {
        console.error('Dashboard businesses error:', error);
        setStatsError('Unable to load business statistics.');
        setStatsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // 3. Load real sales analytics from protected backend.
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setReceiptError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const api = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${api}/api/admin/analytics/overview`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to load analytics.');
      setAnalyticsData(result);
      setReceiptCounts(Object.fromEntries(result.businesses.map(b => [b.id, b.receipts])));
    } catch (error) {
      setReceiptError(error.message);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => {
    if (activePage === 'Dashboard' || activePage === 'Analytics') loadAnalytics();
  }, [activePage, loadAnalytics]);

  // =====================================
  // 4. Calculate Dashboard Statistics
  // =====================================

  const totalBusinesses = businesses.length;

  const activeBusinesses = businesses.filter(
    (business) => business.status === 'active'
  ).length;

  const totalReceipts = analyticsData?.totals?.digitalReceipts || 0;

  // Illustrative paper-saving estimate:
  // 3 grams per avoided paper receipt.
  // 1 gram is an adjustable illustrative estimate per avoided receipt.
  const paperSavedGrams = totalReceipts * 1;

  const paperSaved =
    paperSavedGrams >= 1000
      ? `${(paperSavedGrams / 1000).toFixed(2)} kg`
      : `${paperSavedGrams} g`;

  const stats = [
    {
      label: 'Total Businesses',
      value: statsLoading
        ? '...'
        : statsError
          ? '—'
          : formatNumber(totalBusinesses),
      change: 'Registered businesses',
      icon: '▣'
    },
    {
      label: 'Active Businesses',
      value: statsLoading
        ? '...'
        : statsError
          ? '—'
          : formatNumber(activeBusinesses),
      change: 'Currently enabled',
      icon: '◷'
    },
    {
      label: 'Digital Receipts',
      value: analyticsLoading ? '...' : receiptError ? '—' : formatNumber(totalReceipts),
      change: 'Generated across all businesses',
      icon: '▤'
    },
    {
      label: 'Paper Saved',
      value: analyticsLoading ? '...' : receiptError ? '—' : paperSaved,
      change: 'Illustrative: 1 g per avoided receipt',
      icon: '♻'
    }
  ];

  // =====================================
  // 5. Logout
  // =====================================

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // =====================================
  // 6. Dashboard Layout
  // =====================================

  return (
    <div className="admin-layout">
      <aside
        className={`admin-sidebar ${
          collapsed ? 'collapsed' : ''
        } ${sidebarOpen ? 'open' : ''}`}
      >
        <div className="sidebar-brand">
          <div className="sidebar-logo">G.</div>

          <div className="sidebar-brand-text">
            <strong>
              GoGreen<span>POS</span>
            </strong>
            <small>SUPER ADMIN</small>
          </div>
        </div>

        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '»' : '«'}
        </button>

        <div className="sidebar-section-title">
          MAIN MENU
        </div>

        <nav className="sidebar-navigation">
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              className={`sidebar-link ${
                activePage === item.label ? 'active' : ''
              }`}
              onClick={() => {
                setActivePage(item.label);
                setSidebarOpen(false);
              }}
            >
              <span className="menu-icon">{item.icon}</span>
              <span className="sidebar-label">
                {item.label}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="sidebar-link logout-link"
            onClick={logout}
            title={collapsed ? 'Logout' : undefined}
            aria-label="Logout"
          >
            <span className="menu-icon">↪</span>
            <span className="sidebar-label">Logout</span>
          </button>

          <div className="sidebar-version">
            GoGreen POS • v1.0
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="admin-main">
        <header className="admin-header">
          <div className="header-left">
            <button
              className="mobile-menu-button"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>

            <div>
              <h1>{activePage}</h1>
              <p>GoGreen POS Management Console</p>
            </div>
          </div>

          <div className="admin-profile">
            <div className="profile-avatar">SA</div>

            <div className="profile-details">
              <strong>Super Admin</strong>
              <span>Administrator</span>
            </div>
          </div>
        </header>

        <main className="admin-content">
          {activePage === 'Dashboard' ? (
            <>
              <div className="welcome-banner">
                <div>
                  <span className="welcome-tag">
                    PLATFORM OVERVIEW
                  </span>

                  <h2>Welcome to GoGreen POS</h2>

                  <p>
                    Manage your businesses, monitor subscriptions
                    and track digital receipt activity from one place.
                  </p>
                </div>

                <div className="welcome-decoration">
                  G.
                </div>
              </div>

              <div className="stats-grid">
                {stats.map((stat) => (
                  <div
                    className="stat-card"
                    key={stat.label}
                  >
                    <div className="stat-card-top">
                      <span>{stat.label}</span>
                      <div className="stat-icon">
                        {stat.icon}
                      </div>
                    </div>

                    <h3>{stat.value}</h3>
                    <p>{stat.change}</p>
                  </div>
                ))}
              </div>

              {statsError && (
                <div className="alert alert-warning mt-3">
                  {statsError}
                </div>
              )}

              {receiptError && (
                <div className="alert alert-warning mt-3">
                  {receiptError}
                </div>
              )}

              <div className="dashboard-grid">
                <section className="dashboard-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Business Management</h3>
                      <p>
                        Manage businesses registered on the platform.
                      </p>
                    </div>

                    <button
                      className="primary-action"
                      onClick={() => setActivePage('Businesses')}
                    >
                      View Businesses
                    </button>
                  </div>

                  {statsLoading ? (
                    <div className="empty-state">
                      <p>Loading businesses...</p>
                    </div>
                  ) : statsError ? (
                    <div className="empty-state">
                      <p>{statsError}</p>
                    </div>
                  ) : businesses.length === 0 ? (
                    <div className="empty-state">
                      <h4>No businesses registered yet</h4>
                      <p>
                        Your registered businesses will appear here.
                      </p>

                      <button
                        className="secondary-action"
                        onClick={() => setActivePage('Businesses')}
                      >
                        Manage Businesses
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 table-responsive">
                      <table className="table align-middle">
                        <thead>
                          <tr>
                            <th>Business</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Receipts</th>
                          </tr>
                        </thead>

                        <tbody>
                          {businesses.slice(0, 5).map((business) => (
                            <tr key={business.id}>
                              <td className="fw-semibold">
                                {business.name}
                              </td>

                              <td>{business.type}</td>

                              <td>
                                <span
                                  className={`badge ${
                                    business.status === 'active'
                                      ? 'text-bg-success'
                                      : 'text-bg-secondary'
                                  }`}
                                >
                                  {business.status}
                                </span>
                              </td>

                              <td>
                                {analyticsLoading ? '...' : receiptError
                                  ? '—'
                                  : formatNumber(
                                      receiptCounts[business.id] || 0
                                    )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="dashboard-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Quick Actions</h3>
                      <p>
                        Frequently used management tools.
                      </p>
                    </div>
                  </div>

                  <div className="quick-actions">
                    {[
                      ['Register Business', 'Businesses'],
                      ['Manage Subscriptions', 'Subscriptions'],
                      ['View Analytics', 'Analytics']
                    ].map(([label, page]) => (
                      <button
                        key={label}
                        onClick={() => setActivePage(page)}
                      >
                        <span>{label}</span>
                        <span>→</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </>
          ) : activePage === 'Businesses' ? (
            <Businesses />
          ) : activePage === 'Subscriptions' ? (
            <AdminSubscriptions />
          ) : activePage === 'Campaigns' ? (
            <AdminPromotions />
          ) : activePage === 'Analytics' ? (
            <Analytics
              businesses={businesses}
              receiptCounts={receiptCounts}
              analyticsData={analyticsData}
              analyticsLoading={analyticsLoading}
              analyticsError={receiptError}
              onRefresh={loadAnalytics}
            />
          ) : (
            <section className="dashboard-panel page-placeholder">
              <span className="welcome-tag">
                {activePage.toUpperCase()}
              </span>

              <h2>{activePage} Management</h2>

              <p>
                This module is ready for the next development phase.
                We will connect it to Firebase Firestore.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}