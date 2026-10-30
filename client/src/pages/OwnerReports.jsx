
import { useEffect, useState } from 'react';
import { auth } from '../firebase';
import './Subscription.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const money = (value) => {
  if (value === null || value === undefined) {
    return 'Not available';
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 'Not available';
  }

  return `Rs. ${number.toLocaleString('en-PK', {
    maximumFractionDigits: 2
  })}`;
};

const formatNumber = (value) =>
  Number(value || 0).toLocaleString('en-PK');

function MonthlyChart({ title, values = {}, currency = false }) {
  const entries = Object.entries(values);

  const maxValue = Math.max(
    1,
    ...entries.map(([, value]) => Math.abs(Number(value) || 0))
  );

  return (
    <div style={{ marginBottom: 30 }}>
      <h4 style={{ marginBottom: 18 }}>{title}</h4>

      {entries.length === 0 ? (
        <p>No data available yet.</p>
      ) : (
        entries.map(([month, value]) => {
          const amount = Number(value) || 0;
          const width = (Math.abs(amount) / maxValue) * 100;

          return (
            <div
              key={month}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 14
              }}
            >
              <span
                style={{
                  width: 85,
                  flexShrink: 0,
                  fontSize: 13
                }}
              >
                {month}
              </span>

              <div
                style={{
                  flex: 1,
                  background: '#edf4ee',
                  height: 25,
                  borderRadius: 6,
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    width: `${width}%`,
                    background: '#168452',
                    height: '100%',
                    borderRadius: 6,
                    transition: 'width 0.4s ease'
                  }}
                />
              </div>

              <strong
                style={{
                  minWidth: 95,
                  textAlign: 'right',
                  fontSize: 12
                }}
              >
                {currency ? money(amount) : formatNumber(amount)}
              </strong>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function OwnerReports() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadReports() {
      try {
        const user = auth.currentUser;

        if (!user) {
          throw new Error('Please log in again.');
        }

        const token = await user.getIdToken();

        const response = await fetch(
          `${API}/api/owner/reports/summary`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.message || 'Unable to load reports.'
          );
        }

        if (active) {
          setData(result.summary || {});
          setError('');
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Reports loading failed.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadReports();

    return () => {
      active = false;
    };
  }, []);

  const monthly = Array.isArray(data?.monthly)
    ? data.monthly
    : [];

  const monthlySales = Object.fromEntries(
    monthly.map((item) => [
      item.month,
      Number(item.total || 0)
    ])
  );

  const monthlyReceipts =
    data?.monthlyReceipts &&
    typeof data.monthlyReceipts === 'object'
      ? data.monthlyReceipts
      : {};

  const monthlyRefunds =
    data?.monthlyRefunds &&
    typeof data.monthlyRefunds === 'object'
      ? data.monthlyRefunds
      : {};

  return (
    <div className="subscription-page">
      <h2>Reports & Analytics</h2>

      <p>
        Private business reports — visible to the owner,
        not the platform Super Admin.
      </p>

      {error && (
        <div className="sub-error">{error}</div>
      )}

      {loading ? (
        <p>Loading reports...</p>
      ) : !data ? (
        <p>Reports could not be loaded.</p>
      ) : (
        <>
          {/* SUMMARY CARDS */}

          <div className="sub-grid">
            <div className="sub-card">
              <h3>Net Sales</h3>
              <strong>{money(data.netSales)}</strong>
            </div>

            <div className="sub-card">
              <h3>Gross Profit (Estimate)</h3>
              <strong>
                {money(data.estimatedGrossProfit)}
              </strong>
              <p>
                Available only when the required
                purchase-cost data exists.
              </p>
            </div>

            <div className="sub-card">
              <h3>Refunds</h3>
              <strong>{money(data.refunds)}</strong>
            </div>

            <div className="sub-card">
              <h3>Digital Receipts</h3>
              <strong>
                {formatNumber(data.receiptCount)}
              </strong>
            </div>
          </div>

          {/* MONTHLY CHARTS */}

          <div className="sub-card">
            <h3>Monthly Charts</h3>

            <MonthlyChart
              title="Monthly Net Sales"
              values={monthlySales}
              currency
            />

            <MonthlyChart
              title="Monthly Digital Receipts"
              values={monthlyReceipts}
            />

            <MonthlyChart
              title="Monthly Refunds"
              values={monthlyRefunds}
              currency
            />
          </div>

          {/* ENVIRONMENTAL IMPACT */}

          <div className="sub-card">
            <h3>Environmental Impact</h3>

            <div className="sub-grid">
              <div>
                <h4>Digital Receipts Generated</h4>
                <strong>
                  {formatNumber(data.receiptCount)}
                </strong>
              </div>

              <div>
                <h4>Estimated Paper Saved</h4>
                <strong>
                  {formatNumber(
                    data.estimatedPaperSavedGrams
                  )} g
                </strong>
              </div>
            </div>

            <p style={{ marginTop: 16 }}>
              Paper saving is an illustrative estimate
              based on approximately 1 gram per
              digital receipt.
            </p>

            <p>
              Trees saved are not calculated because
              a reliable conversion factor has not
              been established.
            </p>
          </div>

          {/* MONTHLY SALES TABLE */}

          <div className="sub-card">
            <h3>Monthly Net Sales Details</h3>

            <div className="sub-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Net Sales</th>
                  </tr>
                </thead>

                <tbody>
                  {monthly.map((item) => (
                    <tr key={item.month}>
                      <td>{item.month}</td>
                      <td>{money(item.total)}</td>
                    </tr>
                  ))}

                  {monthly.length === 0 && (
                    <tr>
                      <td colSpan={2}>
                        No monthly sales available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data.limited && (
              <p style={{ marginTop: 12 }}>
                Showing up to 2,000 latest sales
                and refunds. These are not
                lifetime totals.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
