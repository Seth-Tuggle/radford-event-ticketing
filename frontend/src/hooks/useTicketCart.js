/**
 * @file hooks/useTicketCart.js
 * @description React hook for the Rolling Cart ticketing system.
 *
 * Owns all cart state: cartItems, cartId, and expiresAt.
 *
 * ── Cross-page sync (React ↔ venue.html) ─────────────────────────────────────
 *   venue-app.js is a separate plain-JS file that runs on the static venue.html
 *   page. It can't call React hooks directly, so the two sides share state
 *   through three localStorage keys:
 *
 *   - "radford_cart"        — JSON array of cart item objects
 *   - "radford_cart_id"     — persistent UUID used as cart_id / hold_id
 *   - "radford_cart_expiry" — ISO timestamp from the last reserve-tickets response
 *
 *   When venue-app.js writes to localStorage from a DIFFERENT tab, the browser
 *   fires a "storage" event on THIS tab — the onStorage listener picks it up.
 *   When venue-app.js writes from the SAME tab (single-tab flow), it dispatches
 *   a custom "cartUpdated" event instead (the "storage" event does not fire for
 *   the writing tab itself).
 *
 * ── Cross-device sync ────────────────────────────────────────────────────────
 *   When a user is logged in on multiple browsers, DynamoDB is the source of
 *   truth. The syncFromBackend() function fetches HELD tickets via get-cart and
 *   reconciles local state. It runs:
 *     1. On mount (initial page load / navigation to cart)
 *     2. On tab focus (visibilitychange → "visible") — so switching back to a
 *        tab instantly picks up changes from another browser, with zero polling
 *        cost while the tab is inactive.
 */
import { useState, useEffect } from 'react';
import ApiService from '../services/ApiService';
import { getUserSub } from '../auth';

/**
 * Reads and parses the cart array from localStorage.
 * Returns an empty array (never throws) so it is safe to call anywhere.
 *
 * @returns {Array} The stored cart items, or [] if storage is empty or corrupt.
 */
function readCartFromStorage() {
  try {
    return JSON.parse(localStorage.getItem('radford_cart') || '[]');
  } catch {
    return [];
  }
}

/**
 * useTicketCart — manages cartItems, cartId, and expiresAt for the Rolling Cart.
 *
 * @returns {{
 *   cartItems: Array,
 *   setCartItems: Function,
 *   cartId: string,
 *   expiresAt: string|null,
 *   addToCart: (eventId: string, seatKeys: string[]) => Promise,
 *   removeFromCart: (eventId: string, seatKeys?: string[]) => Promise,
 *   clearExpiry: () => void,
 * }}
 */
export default function useTicketCart() {
  const [cartItems, setCartItemsState] = useState(readCartFromStorage);
  // Read-only on mount: do NOT mint a cart_id just because Cart.jsx rendered.
  // A UUID is only needed at the moment we actually reserve seats, and
  // venue-app.js mints one itself at that point. Minting here would leak a
  // UUID into localStorage for every user who just opens an empty cart page.
  //
  // ── Why cartId is reactive (not just read-once) ────────────────────────────
  // Cross-device sync (useEffect below) writes the correct hold_id to
  // localStorage AFTER mount. If cartId were a plain useState with no setter,
  // checkout would use the stale/null value from mount time, sending the wrong
  // cart_id to reserve-tickets extend_only — which silently fails to extend
  // the hold, leaving tickets on the original 10-min timer that expires before
  // the Stripe webhook can finalize the sale.
  const [cartId, setCartId] = useState(() => localStorage.getItem('radford_cart_id'));
  const [expiresAt, setExpiresAt] = useState(
    () => localStorage.getItem('radford_cart_expiry') || null
  );

  /** Write cartItems to both React state and localStorage, then notify Nav. */
  const setCartItems = (items) => {
    setCartItemsState(items);
    localStorage.setItem('radford_cart', JSON.stringify(items));
    window.dispatchEvent(new Event('cartUpdated'));
  };

  // ── Mount: owner_id backfill + hold extension ────────────────────────────
  // If the user just logged in after reserving as a guest, the HELD tickets
  // in DynamoDB have no owner_id. Calling extend_only with the user's sub
  // stamps owner_id AND extends the hold timer. Both are necessary:
  //   - owner_id enables cross-device sync (get-cart queries by owner_id)
  //   - extending the hold prevents seats from expiring during checkout
  // The frontend timer always syncs to the backend's hold_expires_at so
  // both browsers show the same countdown.
  useEffect(() => {
    const reserved = cartItems.filter(i => i.fromVenuePage && i.seatKeys?.length);
    if (reserved.length === 0) return;
    if (!cartId) return;

    const sub = getUserSub();

    // If timer is already running AND no user is logged in, nothing to do
    if (expiresAt && !sub) return;

    // If timer is running AND user is logged in, we still need to backfill
    // owner_id on guest-reserved tickets. Skip only if we've already done it
    // this session (flag prevents re-calling on every mount in StrictMode).
    // localStorage (not sessionStorage) so the flag is visible across tabs —
    // browser 2 skips the backfill that browser 1 already performed.
    const backfillKey = `radford_owner_backfill_${cartId}`;
    if (expiresAt && sub && localStorage.getItem(backfillKey)) return;

    // Call extend_only to stamp owner_id AND extend the hold. Both are critical:
    // owner_id enables get-cart; extending prevents expiry during checkout.
    const extendPromises = reserved.map(item =>
      ApiService.reserveTickets({
        event_id: item.eventId || item.id,
        cart_id: cartId,
        owner_id: sub || undefined,
        extend_only: true,
      })
    );

    Promise.all(extendPromises).then(results => {
      let latestExpiry = null;
      results.forEach(result => {
        if (result.success && result.data?.expires_at) {
          latestExpiry = result.data.expires_at;
        }
      });
      // Always sync the frontend timer to the backend's authoritative value.
      // This ensures all browsers count down from the same hold_expires_at.
      // The timer may bump slightly on login (e.g. 7:00 → 10:00) — this is
      // correct because the backend DID extend the hold.
      if (latestExpiry) {
        setExpiresAt(latestExpiry);
        localStorage.setItem('radford_cart_expiry', latestExpiry);
      }
      if (sub) localStorage.setItem(backfillKey, '1');
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cross-device cart sync (mount + tab focus) ─────────────────────────
  // Fetches the authoritative cart from DynamoDB via get-cart and reconciles
  // local state. Runs on mount AND whenever the tab regains focus, so
  // switching to this browser instantly reflects changes made on another
  // browser (empty cart, add/remove seats, etc.) with zero polling cost.
  //
  // Reads comparison state from localStorage (not React state) to avoid
  // stale closures — the visibilitychange listener captures this function
  // once at mount time.
  useEffect(() => {
    const syncFromBackend = async (isRefocus = false) => {
      const sub = getUserSub();
      if (!sub) return;

      const result = await ApiService.getCart(sub);
      if (!result.success) return;
      const allTickets = result.data?.tickets || [];

      // ── Filter out expired holds ──────────────────────────────────────
      const now = Date.now();
      const toMs = (v) => (typeof v === 'number' ? v * 1000 : new Date(v).getTime());
      const tickets = allTickets.filter(t => !t.hold_expires_at || toMs(t.hold_expires_at) > now);

      // Read current local state from localStorage (avoids stale closures)
      const localCart = readCartFromStorage();
      const localExpiry = localStorage.getItem('radford_cart_expiry') || null;
      const localCartId = localStorage.getItem('radford_cart_id');

      if (tickets.length === 0) {
        // Only clear the local cart on tab re-focus, NOT on initial mount.
        // On mount, the backfill (stamp_owner_only) races with this sync —
        // get-cart may return 0 because owner_id hasn't been stamped yet.
        // On re-focus, backfill ran long ago; 0 tickets genuinely means
        // another browser emptied the cart or the holds expired.
        if (isRefocus && localCart.length > 0) {
          setCartItemsState([]);
          localStorage.setItem('radford_cart', '[]');
          setExpiresAt(null);
          localStorage.removeItem('radford_cart_expiry');
          window.dispatchEvent(new Event('cartUpdated'));
        }
        return;
      }

      // ── Check if local cart already matches backend ───────────────────
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
      const allEnriched = localCart.length > 0 &&
        localCart.every(i => i.event_name && !UUID_RE.test(i.event_name));

      const backendTicketIds = tickets.map(t => t.ticket_id).sort().join(',');
      const localTicketIds = localCart
        .flatMap(i => i.ticketIds || []).sort().join(',');
      const backendExpiry = tickets
        .map(t => t.hold_expires_at).filter(Boolean).sort()[0];

      const expiryMatches = !backendExpiry || !localExpiry ||
        Math.abs(toMs(backendExpiry) - new Date(localExpiry).getTime()) < 5000;

      if (allEnriched && backendTicketIds === localTicketIds && expiryMatches) return;

      // ── Fetch event names and pricing tiers in parallel ───────────────
      const eventIds = [...new Set(tickets.map(t => t.event_id))];

      const [eventsResult, ...pricingResults] = await Promise.all([
        ApiService.getEvents(),
        ...eventIds.map(eid => ApiService.getPricingTiers(eid)),
      ]);

      // Build event_id → event details map (name, date, venue)
      const eventInfoMap = {};
      if (eventsResult.success && eventsResult.data) {
        const list = Array.isArray(eventsResult.data) ? eventsResult.data : (eventsResult.data.items || []);
        list.forEach(e => {
          const id = e.event_id || e.id;
          if (id) {
            eventInfoMap[id] = {
              name: e.event_name || e.title || e.opponent || id,
              date: e.date_time || e.date || e.event_date || '',
              venue: e.venue_name || e.location || e.venue || '',
            };
          }
        });
      }

      // Build event_id → { tier: price } map
      const pricingMap = {};
      eventIds.forEach((eid, i) => { pricingMap[eid] = pricingResults[i] || {}; });

      // Index local cart entries by event id so we can preserve fields the
      // backend doesn't know about: venue-side discounted tierPrices, pre-formatted
      // date + time strings, and disabledSeats. Without this carryover the sync
      // clobbers discounts (showing full price) and raw ISO timestamps.
      const localByEvent = {};
      localCart.forEach(i => { if (i.id || i.eventId) localByEvent[i.id || i.eventId] = i; });

      const formatEventDateTime = (raw) => {
        if (!raw) return { date: '', time: '' };
        const d = new Date(raw);
        if (isNaN(d)) return { date: raw, time: '' };
        return {
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        };
      };

      // ── Group HELD tickets by event_id to build cart items ────────────
      const grouped = {};
      tickets.forEach(t => {
        const eid = t.event_id;
        if (!grouped[eid]) {
          const info = eventInfoMap[eid] || {};
          const local = localByEvent[eid] || {};
          const backendPrices = pricingMap[eid] || {};
          // Prefer local discounted tierPrices when the local entry has them for
          // every tier backend knows about; otherwise fall back to backend pricing.
          const localHasAllTiers = local.tierPrices &&
            Object.keys(backendPrices).every(tier => local.tierPrices[tier] != null);
          const effectivePrices = localHasAllTiers ? local.tierPrices : backendPrices;
          const fmt = local.date && local.date !== 'TBD' && !/^\d{4}-\d{2}-\d{2}T/.test(local.date)
            ? { date: local.date, time: local.time || '' }
            : formatEventDateTime(info.date);
          grouped[eid] = {
            id: eid,
            eventId: eid,
            event_id: eid,
            event_name: info.name || t.event_name || eid,
            date: fmt.date,
            time: fmt.time,
            venue: info.venue || local.venue || '',
            fromVenuePage: true,
            seatKeys: [],
            seatTiers: [],
            seats: [],
            ticketIds: [],
            quantity: 0,
            price: 0,
            hold_id: t.hold_id,
            tierPrices: effectivePrices,
          };
        }
        const g = grouped[eid];
        if (t.seat_key) g.seatKeys.push(t.seat_key);
        if (t.ticket_id) g.ticketIds.push(t.ticket_id);
        if (t.seat_key && t.tier) g.seatTiers.push({ seatKey: t.seat_key, tier: t.tier });
        if (t.seat_key) {
          const label = `Row ${t.seat_key.replace('#', '-')} (${t.tier || 'General'}${t.disability ? ', disability' : ''})`;
          g.seats.push(label);
        }
        g.quantity += 1;
      });

      // ── Calculate per-item price from pricing tiers ───────────────────
      // Use the effective tierPrices on the item (which honors local discounts
      // when present) rather than the raw backend pricing map.
      const items = Object.values(grouped);
      items.forEach(item => {
        const tp = item.tierPrices || {};
        let total = 0;
        item.seatTiers.forEach(st => { total += tp[st.tier] || 0; });
        item.price = item.quantity > 0 ? total / item.quantity : 0;
      });

      setCartItemsState(items);
      localStorage.setItem('radford_cart', JSON.stringify(items));
      window.dispatchEvent(new Event('cartUpdated'));

      // Always sync the timer to the backend's authoritative hold_expires_at.
      // The backend is the source of truth — when another browser extends the
      // hold (via login backfill or cart edits), both browsers should reflect
      // the same remaining time.
      const earliestExpiry = tickets
        .map(t => t.hold_expires_at)
        .filter(Boolean)
        .sort()[0];
      if (earliestExpiry) {
        const isoExpiry = typeof earliestExpiry === 'number'
          ? new Date(earliestExpiry * 1000).toISOString()
          : earliestExpiry;
        setExpiresAt(isoExpiry);
        localStorage.setItem('radford_cart_expiry', isoExpiry);
      }

      // Persist the hold_id so checkout can reference it.
      const holdId = tickets[0]?.hold_id;
      if (holdId) {
        localStorage.setItem('radford_cart_id', holdId);
        setCartId(holdId);
      }
    };

    // Run immediately on mount (isRefocus=false — don't clear cart on 0 tickets
    // because backfill may not have stamped owner_id yet).
    syncFromBackend(false).catch(() => {});

    // Re-run when the tab regains focus (isRefocus=true — safe to clear cart
    // if backend returns 0 tickets, since backfill ran long ago).
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncFromBackend(true).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync when venue.html writes to localStorage from its own tab (storage event
  // fires on all same-origin tabs except the writing one).
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'radford_cart') {
        try { setCartItemsState(JSON.parse(e.newValue || '[]')); } catch { setCartItemsState([]); }
      }
      if (e.key === 'radford_cart_expiry') {
        setExpiresAt(e.newValue || null);
      }
      // Keep cartId in sync when venue.html (another tab) writes a new hold_id
      if (e.key === 'radford_cart_id' && e.newValue) {
        setCartId(e.newValue);
      }
    };
    // cartUpdated is dispatched by setCartItems for same-tab updates.
    const onCartUpdated = () => {
      setCartItemsState(readCartFromStorage());
      setExpiresAt(localStorage.getItem('radford_cart_expiry') || null);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('cartUpdated', onCartUpdated);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('cartUpdated', onCartUpdated);
    };
  }, []);

  /**
   * Reserves seats via the backend API. On success, updates cartItems and expiresAt.
   *
   * @param {string} eventId
   * @param {string[]} seatKeys - Raw seat keys e.g. ["A#1", "B#3"]
   */
  const addToCart = async (eventId, seatKeys) => {
    const result = await ApiService.reserveTickets({
      event_id: eventId,
      seat_keys: seatKeys,
      cart_id: cartId,
      owner_id: getUserSub() || undefined,
    });
    if (result.success && result.data?.expires_at) {
      setExpiresAt(result.data.expires_at);
      localStorage.setItem('radford_cart_expiry', result.data.expires_at);

      // Persist ticket_ids from the reserve response into the matching cart item
      // so MyTickets.jsx can call generateQRCode(ticketId, eventId) after purchase.
      if (Array.isArray(result.data.ticket_ids) && result.data.ticket_ids.length > 0) {
        const cart = readCartFromStorage();
        const idx = cart.findIndex(item => (item.id || item.event_id) === eventId);
        if (idx >= 0) {
          const prev = cart[idx].ticketIds || [];
          cart[idx].ticketIds = [...new Set([...prev, ...result.data.ticket_ids])];
          localStorage.setItem('radford_cart', JSON.stringify(cart));
        }
      }

      // Refresh cartItems from localStorage so any items written by venue.html are visible
      setCartItemsState(readCartFromStorage());
    }
    return result;
  };

  /**
   * Releases reserved seats via the backend API and removes the item from cartItems.
   * Pass seatKeys to release specific seats; omit to release all seats for the event.
   *
   * @param {string} eventId
   * @param {string[]} [seatKeys] - Omit to release the entire event hold.
   */
  const removeFromCart = async (eventId, seatKeys) => {
    const payload = { event_id: eventId, hold_id: cartId };
    if (seatKeys?.length) payload.seat_keys = seatKeys;
    const result = await ApiService.releaseTickets(payload);
    // Update local cartItems on success
    if (result.success) {
      const newItems = cartItems.filter(i => (i.id || i.event_id) !== eventId);
      setCartItems(newItems);
      if (newItems.length === 0) clearExpiry();
    }
    return result;
  };

  /** Clears the expiry timestamp from state and localStorage. */
  const clearExpiry = () => {
    setExpiresAt(null);
    localStorage.removeItem('radford_cart_expiry');
  };

  return { cartItems, setCartItems, cartId, expiresAt, addToCart, removeFromCart, clearExpiry };
}
