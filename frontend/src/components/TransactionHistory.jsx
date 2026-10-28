/**
 * @file components/TransactionHistory.jsx
 * @description Transaction History page — displays all Stripe payment records
 * for the currently authenticated user from the Sandbox environment.
 *
 * Ported from: snapshot/TransactionHistory.html + snapshot/script.js
 *
 * Data source:
 *  Fetches from the Team payments API endpoint using the Cognito ID token
 *  stored in localStorage by AWS Amplify / Cognito's hosted UI. The token
 *  key follows Cognito's standard localStorage naming convention:
 *    CognitoIdentityServiceProvider.<clientId>.<username>.idToken
 *
 * Auth:
 *  If no valid Cognito token is found, a "not logged in" error is shown
 *  in place of the list. The user must log in via the Login page first.
 *
 * localStorage keys consumed (read-only):
 *  - "CognitoIdentityServiceProvider.<CLIENT_ID>.LastAuthUser"
 *  - "CognitoIdentityServiceProvider.<CLIENT_ID>.<username>.idToken"
 */
import { useState, useEffect, useCallback } from 'react';

/** Stripe sandbox payments endpoint */
const API_URL = "https://service.example.invalid/api/payments";

/**
 * Reads the current user's Cognito ID token from the locations written by
 * this app's custom PKCE flow (see auth.js).
 *
 * Storage contract (written by auth.js after a successful sign-in):
 *   - sessionStorage.idToken — primary, authoritative.
 *   - localStorage.token     — shim for cross-page access (Header, Nav, etc.).
 *
 * The original port of this component assumed AWS Amplify-style localStorage
 * keys (e.g. `CognitoIdentityServiceProvider.<clientId>.<user>.idToken`), but
 * this app does not use Amplify — so we read the keys auth.js actually sets.
 *
 * @returns {string|null} The raw JWT id token, or null if not authenticated.
 */
function getCognitoToken() {
  return sessionStorage.getItem('idToken') || localStorage.getItem('token') || null;
}

/**
 * TransactionHistory — fetches and displays Stripe sandbox payment records.
 *
 * @returns {JSX.Element} A list of transaction items, an empty state, or an
 *   error message if authentication fails or the fetch errors out.
 */
export default function TransactionHistory() {
  const [payments, setPayments] = useState([]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'error' | 'success'
  const [errorMessage, setErrorMessage] = useState('');

  const fetchPayments = useCallback(async () => {
    const token = getCognitoToken();
    if (!token) {
      setStatus('error');
      setErrorMessage('Not logged in. Please log in first.');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch(API_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (data.error) throw new Error(data.error);

      setPayments(data);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message || 'An unexpected error occurred.');
    }
  }, []);

  // Auto-fetch on mount so the page isn't blank on first load
  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderContent = () => {
    if (status === 'loading') {
      return (
        <div className="empty-state">
          <p className="empty-message">Connecting to Stripe...</p>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="empty-state">
          <p className="empty-message" style={{ color: 'var(--radford-red)' }}>
            {errorMessage}
          </p>
        </div>
      );
    }

    if (status === 'idle') {
      return (
        <div className="empty-state">
          <p className="empty-message">
            No data loaded. Click refresh to fetch from Stripe Sandbox.
          </p>
        </div>
      );
    }

    if (payments.length === 0) {
      return (
        <div className="empty-state">
          <p className="empty-message">No transactions found.</p>
        </div>
      );
    }

    return (
      <div className="transactions-list">
        {payments.map((payment) => {
          const date = new Date(payment.created * 1000).toLocaleDateString();
          const displayName = payment.description || 'Radford Event Ticket';
          const isFree = payment.amount === 0;

          return (
            <div key={payment.id} className="transaction-item">
              <div className="transaction-info">
                <div className="transaction-event">{displayName}</div>
                <div className="transaction-meta">
                  ID: {payment.id} • Status: Succeeded • Sandbox Environment
                </div>
              </div>
              <div className={`transaction-amount${isFree ? ' free' : ''}`}>
                {isFree ? 'Free' : `$${payment.amount.toFixed(2)}`}
              </div>
              <div className="transaction-time">{date}</div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Layout (matches snapshot structure) ────────────────────────────────────

  return (
    <>
        <div
          style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
        >
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          Transaction History
        </h2>
        <button className="btn-primary" onClick={fetchPayments}>
          Refresh Sandbox Data
        </button>
      </div>

      <div id="payment-list">{renderContent()}</div>
    </>
  );
}
