/**
 * @file components/Cart.jsx
 * @description Shopping cart page — review, adjust, and purchase selected tickets.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *   - Render each cart item from useTicketCart().cartItems
 *   - Show the CartTimer countdown when expiresAt is set
 *   - Let the user remove individual events or empty the entire cart
 *   - Show an expiry modal when the backend's 10-minute hold expires
 *   - Complete the purchase via real Stripe payment flow
 *
 * ── Two types of cart items ───────────────────────────────────────────────────
 *   fromVenuePage: true  — seat-map selections from venue.html
 *     • Shows "Edit Seats" link back to venue.html and a "Remove" button
 *     • Remove calls release-tickets via the hook (frees the backend hold)
 *
 *   fromVenuePage: false/absent — generic items (future use)
 *     • Shows a quantity spinner (+/−) and a "Remove" button
 *     • Remove only updates local state (no backend hold to release)
 *
 * ── Timer expiry flow ─────────────────────────────────────────────────────────
 *   CartTimer fires onExpire() at t=0. At that exact moment the backend SQS
 *   worker has already released all seats. The frontend clears local cart state
 *   and shows the expiry modal. No API call is needed — the backend is authoritative.
 *
 * ── Login redirect flow ──────────────────────────────────────────────────────
 *   If a guest clicks "Complete Purchase", they are redirected to /login with
 *   a returnTo flag. After login, they return to /cart and can click
 *   "Complete Purchase" again. No auto-checkout — the user stays in control.
 *
 * ── Checkout flow (Team 03 + Team 04 integration) ───────────────────────────
 *   1. Extend hold to 35 min (checkout-grade) via reserve with extend_only+checkout
 *   2. Write per-tier cart records to Team01-CartServices DynamoDB
 *   3. Call team04-checkout to create a Stripe Checkout Session
 *   4. Redirect user to Stripe's hosted payment page
 *   5. After payment, Stripe redirects to /mytickets (success) or /cart (cancel)
 *   6. Team 04's webhook deletes cart → DynamoDB Stream → team03-complete-purchase
 *      → sell-tickets finalizes HELD → SOLD and generates QR codes
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import CartTimer from './CartTimer';
import Toast from './Toast';
import useTicketCart from '../hooks/useTicketCart';
import ApiService from '../services/ApiService';
import { getTokens, getUserSub } from '../auth';

/**
 * Formats a raw ISO-8601 date string into a human-readable form.
 * Example: "2026-06-04T12:35:00-04:00" → "Jun 4, 2026 · 12:35 PM"
 * Returns the original string if parsing fails.
 *
 * @param {string|null} dateStr - ISO date or datetime string from the events API.
 * @returns {string|null} Formatted date, or null if input is empty.
 */
function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const date = d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
    return `${date} \u00b7 ${time}`;
  } catch {
    return dateStr;
  }
}

export default function Cart() {
  const { cartItems, setCartItems, cartId, expiresAt, removeFromCart, clearExpiry } = useTicketCart();
  const [cartExpired, setCartExpired] = useState(false);
  const [checkoutInProgress, setCheckoutInProgress] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const navigate = useNavigate();
  const dismissCheckoutError = useCallback(() => setCheckoutError(null), []);

  /**
   * Updates the quantity of a generic (non-fromVenuePage) cart item.
   * Drops the item when qty falls below 1.
   */
  const updateQuantity = (id, qty) => {
    if (qty < 1) {
      handleRemove(id);
      return;
    }
    const newItems = cartItems.map(item =>
      (item.id === id || item.event_id === id) ? { ...item, quantity: qty } : item
    );
    setCartItems(newItems);
  };

  /**
   * Removes an item from the cart.
   * For reserved seat items (fromVenuePage), also calls release-tickets with seat_keys.
   * For generic items, only updates local state.
   */
  const handleRemove = (id) => {
    const item = cartItems.find(i => i.id === id || i.event_id === id);
    if (item?.fromVenuePage) {
      removeFromCart(item.eventId || id, item.seatKeys);
    } else {
      const newItems = cartItems.filter(i => i.id !== id && i.event_id !== id);
      setCartItems(newItems);
      if (newItems.length === 0) clearExpiry();
    }
  };

  /**
   * Empties the entire cart.
   * Calls release-tickets (without seat_keys) for each reserved event to free all seats.
   */
  const emptyCart = () => {
    cartItems.forEach(item => {
      if (item.fromVenuePage) {
        removeFromCart(item.eventId || item.id);
      }
    });
    setCartItems([]);
    clearExpiry();
  };

  /**
   * Called by CartTimer when the countdown reaches 0:00.
   * The backend SQS worker has already released the seats at this exact moment.
   * Clears local state and shows the expiry modal.
   */
  const handleExpire = () => {
    setCartItems([]);
    clearExpiry();
    setCartExpired(true);
  };

  const getCartTotal = () =>
    cartItems.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);

  /**
   * Handles checkout button click — real Stripe payment flow.
   *
   * ── Flow ─────────────────────────────────────────────────────────────────
   *   1. If not logged in → redirect to /login with returnTo=/cart
   *   2. Extend hold to 35 min (checkout-grade) via reserve with extend_only+checkout
   *      - This also VALIDATES that all seats are still HELD. If any expired,
   *        the call fails and the user is NOT sent to Stripe.
   *   3. Write per-tier cart records to Team01-CartServices DynamoDB
   *   4. Call team04-checkout to create a Stripe Checkout Session
   *   5. Redirect user to Stripe's hosted payment page
   *
   * After payment, Stripe redirects to /mytickets. Team 04's webhook deletes
   * the cart records → DynamoDB Stream → team03-complete-purchase calls
   * sell-tickets → HELD → SOLD → QR codes generated.
   */
  const handleCheckout = async () => {
    // ── Gate: must be logged in ────────────────────────────────────────────
    const token = localStorage.getItem('token');
    if (!token) {
      sessionStorage.setItem('radford_returnTo', '/cart');
      navigate('/login');
      return;
    }

    // ── Gate: prevent double-click (mitigates double-pay from multiple tabs)
    if (checkoutInProgress) return;
    setCheckoutInProgress(true);
    setCheckoutError(null);

    try {
      const userSub = getUserSub();
      const { accessToken } = getTokens();

      if (!userSub || !accessToken) {
        setCheckoutError('Your session has expired. Please log in again.');
        sessionStorage.setItem('radford_returnTo', '/cart');
        navigate('/login');
        return;
      }

      // ── Step 3: Extend hold to 35 min (checkout-grade) ──────────────────
      // Calls reserve with extend_only + checkout flags. This validates that
      // all seats are still HELD. If any expired, we abort — no Stripe redirect.
      const reservedItems = cartItems.filter(i => i.fromVenuePage && i.seatKeys?.length);
      for (const item of reservedItems) {
        const extendResult = await ApiService.reserveTickets({
          event_id: item.eventId || item.id,
          cart_id: cartId,
          owner_id: userSub,
          extend_only: true,
          checkout: true,
        });
        if (!extendResult.success) {
          setCheckoutError(
            'Some of your seats have expired. Please go back to the event and re-select your seats.'
          );
          setCheckoutInProgress(false);
          return;
        }
      }

      // ── Step 4: Write per-tier cart records to Team01-CartServices ───────
      // Build the items array with tier grouping for team03-write-cart Lambda.
      const writeItems = cartItems
        .filter(i => i.fromVenuePage)
        .map(item => ({
          event_id: item.eventId || item.id,
          event_name: item.event_name || item.opponent || 'Event',
          seatTiers: item.seatTiers || [],
          ticket_ids: item.ticketIds || [],
          hold_id: cartId,
          tierPrices: item.tierPrices || {},
        }));

      const writeResult = await ApiService.writeCart({
        user_sub: userSub,
        items: writeItems,
      });

      if (!writeResult.success) {
        setCheckoutError('Failed to prepare your cart for payment. Please try again.');
        setCheckoutInProgress(false);
        return;
      }

      // ── Step 5: Create Stripe Checkout Session via team04-checkout ──────
      const checkoutResult = await ApiService.createCheckoutSession(accessToken);

      if (!checkoutResult.success || !checkoutResult.data?.url) {
        setCheckoutError('Failed to create payment session. Please try again.');
        setCheckoutInProgress(false);
        return;
      }

      // ── Step 6: Redirect to Stripe's hosted payment page ────────────────
      // After payment, Stripe redirects to /mytickets (success) or /cart (cancel).
      // Set flag so MyTickets can clear the cart on arrival (success path).
      sessionStorage.setItem('stripe_checkout_pending', '1');
      window.location.href = checkoutResult.data.url;
    } catch (err) {
      console.error('[Cart] Checkout error:', err);
      setCheckoutError('An unexpected error occurred. Please try again.');
      setCheckoutInProgress(false);
    }
  };

  // ── Expiry modal ──────────────────────────────────────────────────────────
  if (cartExpired) {
    return (
      <>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--radford-red)' }}>Shopping Cart</h2>
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          background: '#fee2e2',
          borderRadius: 'var(--radius)',
          border: '1.5px solid #dc2626',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>&#9200;</div>
          <h3 style={{ color: '#dc2626', marginBottom: '0.75rem' }}>Your cart has expired</h3>
          <p style={{ color: '#7f1d1d', marginBottom: '1.5rem' }}>
            Your cart has expired and your tickets have been released.
          </p>
          <button className="btn-primary" onClick={() => { setCartExpired(false); navigate('/'); }}>
            Browse Events
          </button>
        </div>
      </>
    );
  }

  // ── Main cart view ────────────────────────────────────────────────────────
  return (
    <>
      <h2 style={{ marginBottom: '1.5rem', color: 'var(--radford-red)' }}>Shopping Cart</h2>

      {/* Countdown timer — shown when there are reserved seats with a live expiry */}
      {cartItems.length > 0 && expiresAt && (
        <CartTimer expiresAt={expiresAt} onExpire={handleExpire} />
      )}

      {cartItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#128722;</div>
          <p>Your cart is empty. Browse events to add tickets.</p>
        </div>
      ) : (
        <>
          {cartItems.map(item => {
            const id = item.id || item.event_id;
            const title = item.event_name || item.opponent;
            return (
              <div key={id} className="ticket-card">
                <div className="cart-item-inner">
                  <div style={{ flex: 1 }}>
                    <h3 className="ticket-title">{title}</h3>
                    {item.date && item.date !== 'TBD' && (
                      <div className="ticket-meta">
                        {'\u{1F4C5}'} {item.date}
                        {item.time && item.time !== 'TBD' ? ` \u2022 \u{1F550} ${item.time}` : ''}
                        {item.venue ? ` \u2022 \u{1F4CD} ${item.venue}` : ''}
                      </div>
                    )}
                    {item.seats && item.seats.length > 0 && (
                      <div className="ticket-meta" style={{ marginTop: '0.5rem' }}>
                        {item.seats.map((seat, idx) => (
                          <div key={idx} style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>&#129681; {seat}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="cart-item-actions">
                    {item.fromVenuePage ? (
                      <>
                        <div style={{ fontSize: '1.6rem', fontWeight: '700', color: 'var(--radford-red)', lineHeight: 1 }}>
                          ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                        </div>
                        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.3rem' }}>
                          <a
                            href={`/venue.html?event_id=${encodeURIComponent(item.eventId || id)}&event_name=${encodeURIComponent(title)}`}
                            style={{ fontSize: '0.82rem', color: 'var(--radford-red)', textDecoration: 'none', fontWeight: '500', border: '1px solid var(--radford-red)', padding: '0.28rem 0.7rem', borderRadius: 'var(--radius)' }}
                          >
                            Edit Seats
                          </a>
                          <button
                            onClick={() => handleRemove(id)}
                            style={{ background: 'none', border: '1px solid #dc2626', color: '#dc2626', padding: '0.28rem 0.7rem', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500' }}
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button className="btn-accent" onClick={() => updateQuantity(id, (item.quantity || 1) - 1)}>&#8722;</button>
                          <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{item.quantity || 1}</span>
                          <button className="btn-accent" onClick={() => updateQuantity(id, (item.quantity || 1) + 1)}>+</button>
                        </div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: 'var(--radford-red)' }}>
                          ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                        </div>
                        <button className="btn-accent" onClick={() => handleRemove(id)}>Remove</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Order summary, empty cart, and checkout */}
          <div className="ticket-card" style={{ borderLeft: '6px solid var(--navy-accent)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Total</h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--radford-red)' }}>
                ${getCartTotal().toFixed(2)}
              </div>
            </div>

            {/* Checkout error — shown as a slide-in toast (bottom-right) */}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                onClick={emptyCart}
                disabled={checkoutInProgress}
                style={{ flex: '0 0 auto', background: 'none', border: '1px solid #6b7280', color: '#6b7280', padding: '0.75rem 1.25rem', borderRadius: 'var(--radius)', cursor: checkoutInProgress ? 'not-allowed' : 'pointer', fontWeight: '500', opacity: checkoutInProgress ? 0.5 : 1 }}
              >
                Empty Cart
              </button>
              <button
                className="btn-primary"
                onClick={handleCheckout}
                disabled={checkoutInProgress}
                style={{ flex: 1, opacity: checkoutInProgress ? 0.7 : 1, cursor: checkoutInProgress ? 'not-allowed' : 'pointer' }}
              >
                {checkoutInProgress ? 'Processing...' : 'Complete Purchase'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Checkout error toast — slides in from bottom-right, matches venue-app.js style */}
      {checkoutError && (
        <Toast
          title="Checkout Error"
          message={checkoutError}
          type="error"
          duration={6000}
          onClose={dismissCheckoutError}
        />
      )}
    </>
  );
}
