/**
 * @file services/ApiService.js
 * @description Centralized API client for the Radford Events Ticketing system.
 *
 * Provides a unified interface to the various backend teams' REST APIs.
 * Each team owns a separate set of routes and may have its own base URL.
 * If a team's endpoint is not yet deployed (base URL is null), all calls
 * to it return a safe sentinel value without throwing, so the rest of
 * the UI continues to function.
 *
 * ── Team API Overview ─────────────────────────────────────────────────────────
 *   Team01 — User profiles / authentication  (null — not deployed yet)
 *   Team02 — Events CRUD                     (routed through Team07 gateway)
 *   Team03 — Tickets & pricing               (null — not deployed yet)
 *   Team05 — Cognito authentication          (separate dedicated endpoint)
 *   Team07 — API Gateway + User Management   (primary gateway URL)
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   import ApiService from './services/ApiService';
 *
 *   // Fetch all events
 *   const { success, data } = await ApiService.getEvents();
 *
 *   // Log in a user
 *   const { success, user } = await ApiService.login('developer@example.com', 'pass');
 *
 * ── Adding a new team endpoint ────────────────────────────────────────────────
 *   1. Add the team's base URL to the APIS object below.
 *   2. Create a new exported function that calls apiFetch() with that URL.
 *   3. Export it via the ApiService object at the bottom of this file.
 */

/**
 * Base URLs for each team's API.
 * Set a value to null to disable that team's endpoint without breaking
 * any code that calls it — apiFetch() returns a safe fallback for null URLs.
 */
const APIS = {
  team05: 'https://service.example.invalid/prod',
  team07: 'https://service.example.invalid/production',
  team01: null, // users/profiles — not deployed yet
  team02: 'https://service.example.invalid/production', // events: GET /Group-2/:id  |  search: GET /Group-2/events?q=
  team03: 'https://service.example.invalid/production', // tickets: reserve, release, available-tickets, pricing-tiers, discounts, generate-qr
  team04: 'https://service.example.invalid/dev', // payment: checkout (Stripe session creation)
};

/**
 * Internal helper that wraps fetch() with consistent JSON handling and
 * error logging. Returns a typed result object instead of throwing, so
 * callers don't need individual try/catch blocks.
 *
 * @param {string|null} baseUrl - The team's API base URL. If null, returns
 *   `{ success: false, data: null, inactive: true }` immediately without
 *   making a network request.
 * @param {string} path - URL path to append to baseUrl (must start with '/').
 *   Example: '/Group-2/events'
 * @param {RequestInit} [options={}] - Standard Fetch API options
 *   (method, body, headers, etc.). Content-Type defaults to 'application/json'.
 * @returns {Promise<{success: boolean, data: any, inactive?: boolean}>}
 *   - success: true if the HTTP response was OK (2xx).
 *   - data: parsed JSON body on success; null on failure.
 *   - inactive: true (and only present) when baseUrl was null.
 */
async function apiFetch(baseUrl, path, options = {}) {
  // Short-circuit immediately for teams whose endpoints are not yet live
  if (!baseUrl) return { success: false, data: null, inactive: true };
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const text = await res.text();
    let data = text ? JSON.parse(text) : {};
    // API Gateway on some routes returns the Lambda envelope as the HTTP body.
    // Unwrap it so callers always receive the actual payload.
    if (data && typeof data.body === 'string' && typeof data.statusCode === 'number') {
      data = JSON.parse(data.body);
    }
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return { success: true, data };
  } catch (err) {
    console.warn(`[API] ${baseUrl}${path} →`, err.message);
    return { success: false, data: null };
  }
}

/**
 * Authenticates a user by username and password.
 *
 * Tries Team05's Cognito-backed `/login` endpoint first. If Team05 is
 * unreachable or returns an error, falls back to Team07's `/auth/login`
 * endpoint. Both accept the same `{ username, password }` JSON body.
 *
 * @param {string} username - The user's username or email address.
 * @param {string} password - The user's plaintext password (sent over HTTPS).
 * @returns {Promise<{success: boolean, user: Object|null}>}
 *   On success, `user` contains the profile/session data from the API.
 *   On failure, `user` is null.
 */
async function login(username, password) {
  const t5 = await apiFetch(APIS.team05, '/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (t5.success) return { success: true, user: t5.data };

  // Team05 failed — try Team07's auth endpoint as a fallback
  const t7 = await apiFetch(APIS.team07, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (t7.success) return { success: true, user: t7.data };

  return { success: false, user: null };
}

/**
 * Fetches all events from the Team02 search endpoint via the Team07 gateway.
 *
 * Team02's `/Group-2/events` route is a search API. When called with no `?q=`
 * parameter it returns all non-cancelled events (Team02 updated their Lambda
 * to support this). If the call fails, EventBoard.jsx falls back to
 * MOCK_EVENTS automatically.
 *
 * @returns {Promise<{success: boolean, data: Array|null}>}
 *   On success, `data` is an array of event objects.
 */
async function getEvents() {
  return apiFetch(APIS.team02, '/Group-2/events');
}

/**
 * Sells reserved tickets — transitions them from HELD → SOLD in DynamoDB.
 * Must be called after reserve-tickets and before the 10-minute hold expires.
 *
 * The backend resolves owner_id from the HELD records (set during reservation),
 * so only event_id and ticket_ids are required here.
 *
 * @param {{ event_id: string, ticket_ids: string[] }} payload
 * @returns {Promise<{success: boolean, data: any}>}
 */
async function purchaseTicket(payload) {
  return apiFetch(APIS.team03, '/Group-3/tickets/sell-tickets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Reserves seats and adds them to the rolling cart. Resets the 10-minute
 * expiry timer for the entire cart on every call.
 *
 * Important: only pass NEW seats (not already held ones) in seat_keys.
 * Sending already-held seats returns a 409 conflict. venue-app.js handles
 * this with diff logic — see handleAddToCart() for details.
 *
 * `owner_id` is optional and is the logged-in user's Cognito sub (immutable
 * UUID, from auth.js's getUserSub()). When present, the lambda persists it
 * on every HELD record so that team03-tickets-sell can resolve owner_id
 * later from just an event_id + ticket_ids payload (the contract Caleb
 * agreed with Team04). Anonymous browsing still works — owner_id is simply
 * omitted.
 *
 * @param {{ event_id: string, seat_keys: string[], cart_id: string, owner_id?: string }} payload
 * @returns {Promise<{success: boolean, data: { reserved: boolean, hold_id: string, expires_at: string, ticket_ids: string[], seat_count: number }|null}>}
 */
async function reserveTickets(payload) {
  return apiFetch(APIS.team03, '/Group-3/tickets/reserve-tickets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Releases reserved seats from the cart. Omit `seat_keys` to release all
 * tickets for the given hold and event (used by "Empty Cart").
 *
 * Called in two situations:
 *   1. User removes a specific event: pass seat_keys to release only those seats.
 *   2. User clicks "Empty Cart": omit seat_keys — backend releases the entire hold.
 *
 * Note: when the 10-minute timer hits 0:00, the backend SQS worker releases
 * all seats automatically. The frontend does NOT need to call this on expiry.
 *
 * @param {{ event_id: string, hold_id: string, seat_keys?: string[] }} payload
 * @returns {Promise<{success: boolean, data: any}>}
 */
async function releaseTickets(payload) {
  return apiFetch(APIS.team03, '/Group-3/tickets/release-tickets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetches a user's profile from the Team01 user service.
 *
 * NOTE: `APIS.team01` is currently null — this function is a no-op and will
 * return `{ success: false, inactive: true }` until Team01 deploys their
 * endpoint and updates `APIS.team01` with the live URL.
 *
 * @param {string} userId - The user's unique identifier.
 * @returns {Promise<{success: boolean, data: Object|null}>}
 */
async function getUserProfile(userId) {
  return apiFetch(APIS.team01, `/users/${userId}`);
}

/**
 * Generates a QR code for a purchased ticket and returns a presigned S3 URL
 * to the QR image (valid for 15 minutes). The QR encodes a verification URL
 * that staff scan at the door to admit the attendee.
 *
 * Only works for tickets with status SOLD. Call this fresh each time the user
 * opens "My Tickets" — the image lives permanently in S3, so re-calling just
 * returns a new short-lived URL to the same image.
 *
 * @param {string} ticketId - The ticket's unique identifier (e.g. "tkt-00978bee").
 * @param {string} eventId  - The event's unique identifier.
 * @returns {Promise<{success: boolean, data: { qr_url?: string, qr_base64?: string, ticket_info: Object }|null}>}
 */
async function generateQRCode(ticketId, eventId) {
  return apiFetch(APIS.team03, '/Group-3/tickets/generate-qr', {
    method: 'POST',
    body: JSON.stringify({ ticket_id: ticketId, event_id: eventId }),
  });
}

/**
 * Fetches all SOLD tickets for the logged-in user from DynamoDB via the
 * OwnerIndex GSI. Requires the user's Cognito sub as owner_id.
 *
 * @param {string} ownerSub - The user's Cognito sub UUID.
 * @returns {Promise<{success: boolean, data: { tickets: Array }|null}>}
 */
async function getMyTickets(ownerSub) {
  return apiFetch(APIS.team03, `/Group-3/tickets/my-tickets?owner_id=${encodeURIComponent(ownerSub)}`);
}

/**
 * Fetches all HELD tickets for the logged-in user — used to sync the cart
 * across devices. Queries the same OwnerIndex GSI as my-tickets but filters
 * for HELD instead of SOLD.
 *
 * @param {string} ownerSub - The user's Cognito sub UUID.
 * @returns {Promise<{success: boolean, data: { tickets: Array }|null}>}
 */
async function getCart(ownerSub) {
  return apiFetch(APIS.team03, `/Group-3/tickets/get-cart?owner_id=${encodeURIComponent(ownerSub)}`);
}

/**
 * Writes per-tier cart records to Team01-CartServices DynamoDB table.
 * Called during checkout (step 4) so that Team 04's team04-checkout Lambda
 * can read the cart and build Stripe line items.
 *
 * @param {{ user_sub: string, items: Array<{ event_id: string, seatTiers: Array, ticket_ids: string[], hold_id: string, tierPrices: Object }> }} payload
 * @returns {Promise<{success: boolean, data: any}>}
 */
async function writeCart(payload) {
  return apiFetch(APIS.team03, '/Group-3/tickets/write-cart', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Calls Team 04's checkout endpoint to create a Stripe Checkout Session.
 * Requires the user's access token (JWT) in the Authorization header so
 * team04-checkout can extract the Cognito sub and query the cart.
 *
 * On success, returns { url, session_id } where url is the Stripe payment page.
 *
 * @param {string} accessToken - The user's Cognito access token (JWT).
 * @returns {Promise<{success: boolean, data: { url?: string, session_id?: string }|null}>}
 */
async function createCheckoutSession(accessToken) {
  return apiFetch(APIS.team04, '/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });
}

/**
 * Fetches pricing tiers for a specific event from the Team03 pricing endpoint.
 * Returns a { tierName: price } lookup map (e.g. { VIP: 100, Standard: 40 }).
 *
 * @param {string} eventId - The event UUID.
 * @returns {Promise<Object>} Tier→price map, or {} on failure.
 */
async function getPricingTiers(eventId) {
  const result = await apiFetch(APIS.team03, `/Group-3/pricing-tiers?event_id=${encodeURIComponent(eventId)}`);
  if (!result.success || !result.data) return {};
  const tiers = Array.isArray(result.data) ? result.data : (result.data.tiers || result.data.items || []);
  const priceMap = {};
  tiers.forEach(t => {
    if (t.tier && t.price !== undefined) priceMap[t.tier] = Number(t.price);
  });
  return priceMap;
}

const ApiService = { login, getEvents, purchaseTicket, getUserProfile, reserveTickets, releaseTickets, generateQRCode, getMyTickets, getCart, writeCart, createCheckoutSession, getPricingTiers };
export default ApiService;
