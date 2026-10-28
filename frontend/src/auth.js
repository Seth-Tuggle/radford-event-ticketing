/**
 * @file auth.js
 * @description Authentication helpers provided by Team01 (User Services).
 *
 * Implements two auth flows:
 *   1. SSO — Cognito Hosted UI via PKCE (the primary Radford login experience).
 *      Flow: initiateSSORedirect() → user authenticates on Cognito → Cognito
 *      redirects back to the app root with ?code= → App.jsx calls
 *      exchangeCodeForTokens(code) to complete the handshake.
 *
 *   2. Direct API — Team01's /login and /signup endpoints for username+password
 *      accounts not tied to Radford SSO.
 *
 * ── Token storage ─────────────────────────────────────────────────────────────
 *   Tokens are stored in sessionStorage (cleared when the browser tab closes):
 *     idToken        — JWT with user claims (email, sub, cognito:username, etc.)
 *     accessToken    — used to authorize downstream API calls
 *     refreshToken   — for silent re-auth (not yet implemented)
 *     tokenExpiresAt — epoch ms when the access token expires
 *
 *   For backward compatibility, localStorage shims are also written on login:
 *     "token"     — set to accessToken (read by Cart.jsx and Nav.jsx)
 *     "userEmail" — decoded from idToken (displayed by Header.jsx)
 *   This means Nav.jsx, Header.jsx, and Cart.jsx require no changes.
 *
 * @see Team01 source: provided by the User Services team.
 */

// ── Cognito / API configuration (provided by Team01) ─────────────────────────

const API_BASE          = 'https://service.example.invalid/Sprint2/Group-1';
const COGNITO_DOMAIN    = 'your-cognito-domain';
const COGNITO_REGION    = 'us-east-1';
const COGNITO_CLIENT_ID = 'YOUR_CLIENT_ID';

const COGNITO_BASE_URL = `https://${COGNITO_DOMAIN}.auth.${COGNITO_REGION}.amazoncognito.com`;

// ── Token helpers ─────────────────────────────────────────────────────────────

/**
 * Persists auth tokens in sessionStorage after a successful login.
 * @param {{ idToken, accessToken, refreshToken, expiresIn }} tokens
 */
export function saveTokens({ idToken, accessToken, refreshToken, expiresIn }) {
  if (idToken)      sessionStorage.setItem('idToken', idToken);
  if (accessToken)  sessionStorage.setItem('accessToken', accessToken);
  if (refreshToken) sessionStorage.setItem('refreshToken', refreshToken);
  if (expiresIn) {
    sessionStorage.setItem('tokenExpiresAt', (Date.now() + expiresIn * 1000).toString());
  }
}

/** Reads all stored auth tokens from sessionStorage. */
export function getTokens() {
  return {
    idToken:      sessionStorage.getItem('idToken'),
    accessToken:  sessionStorage.getItem('accessToken'),
    refreshToken: sessionStorage.getItem('refreshToken'),
    expiresAt:    sessionStorage.getItem('tokenExpiresAt'),
  };
}

/** Removes all auth tokens from sessionStorage and the localStorage shims. */
export function clearTokens() {
  ['idToken', 'accessToken', 'refreshToken', 'tokenExpiresAt'].forEach(k =>
    sessionStorage.removeItem(k)
  );
  localStorage.removeItem('token');
  localStorage.removeItem('idToken');
  localStorage.removeItem('accessToken');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userSub');
  localStorage.removeItem('userProfile');
  // Notify Nav.jsx so the Login link reappears immediately (same-tab update)
  window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: null }));
}

/** Returns true when a non-expired access token exists in sessionStorage. */
export function isTokenValid() {
  const { accessToken, expiresAt } = getTokens();
  if (!accessToken) return false;
  if (expiresAt && Date.now() > parseInt(expiresAt)) return false;
  return true;
}

// ── JWT decode (no signature verification — client-side claim reading only) ───

/**
 * Decodes a JWT payload without verifying the signature.
 * Used only to read non-sensitive claims (email, username) for display.
 *
 * @param {string} token
 * @returns {Object|null} Decoded payload, or null if parsing fails.
 */
export function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Returns the logged-in user's email from the stored idToken.
 * Falls back to the Cognito username claim if email is absent.
 * Returns null if the user is not logged in or the token is missing.
 *
 * @returns {string|null}
 */
export function getUserEmail() {
  const { idToken } = getTokens();
  if (!idToken) return null;
  const decoded = decodeJwt(idToken);
  return decoded?.email || decoded?.['cognito:username'] || null;
}

/**
 * Returns the logged-in user's Cognito `sub` (immutable UUID) from the idToken.
 * Used as `owner_id` for ticket reservation and purchase — preferred over email
 * because sub never changes, isn't PII, and matches what Team 04 extracts from
 * the Cognito token during Stripe payment processing.
 *
 * Checks three sources in priority order:
 *   1. idToken in sessionStorage (primary — set by SSO and direct API login)
 *   2. "userSub" localStorage shim (set by writeLocalStorageShims)
 *   3. idToken in localStorage (some auth flows or returning sessions store
 *      tokens there instead of sessionStorage)
 *
 * @returns {string|null}
 */
export function getUserSub() {
  // Primary: idToken in sessionStorage
  const { idToken } = getTokens();
  if (idToken) {
    const decoded = decodeJwt(idToken);
    if (decoded?.sub) return decoded.sub;
  }
  // Fallback: localStorage shim
  const shim = localStorage.getItem('userSub');
  if (shim) return shim;
  // Fallback: idToken in localStorage (returning session or alternate auth flow)
  const lsIdToken = localStorage.getItem('idToken');
  if (lsIdToken) {
    const decoded = decodeJwt(lsIdToken);
    if (decoded?.sub) return decoded.sub;
  }
  return null;
}

// ── Internal: write localStorage shims ───────────────────────────────────────

/**
 * Writes localStorage shims so that Nav.jsx, Header.jsx, Cart.jsx, and
 * venue-app.js detect the session without needing sessionStorage access.
 *
 *   "token"     — accessToken (read by Cart.jsx and Nav.jsx)
 *   "userEmail" — display name (read by Header.jsx)
 *   "userSub"   — Cognito sub UUID (read by venue-app.js as owner_id)
 *
 * Also dispatches a synthetic StorageEvent so Nav.jsx's same-tab listener
 * picks up the login immediately (the browser only auto-fires "storage"
 * for writes made by OTHER tabs).
 */
function writeLocalStorageShims(accessToken, email, sub, idToken) {
  localStorage.setItem('token', accessToken);
  localStorage.setItem('userEmail', email);
  if (sub) localStorage.setItem('userSub', sub);
  // Write idToken + accessToken so AuthService.getTokens() works for Profile.jsx saves
  if (idToken) localStorage.setItem('idToken', idToken);
  if (accessToken) localStorage.setItem('accessToken', accessToken);
  window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: accessToken }));

  // ── Post-login cart sync ──────────────────────────────────────────────
  // If the user has HELD seats in the backend (reserved on another device,
  // or reserved as a guest on this device before logging in), fetch them
  // and write to localStorage so Nav.jsx's cart badge updates immediately
  // without waiting for Cart.jsx to mount.
  if (sub) {
    const API_BASE = 'https://service.example.invalid/production';
    fetch(`${API_BASE}/Group-3/tickets/get-cart?owner_id=${encodeURIComponent(sub)}`)
      .then(r => r.json())
      .then(data => {
        // Unwrap Lambda envelope if present
        const parsed = (typeof data.body === 'string' && typeof data.statusCode === 'number')
          ? JSON.parse(data.body) : data;
        const tickets = parsed.tickets || [];
        if (tickets.length === 0) return;

        // Filter out expired holds
        const now = Date.now();
        const toMs = (v) => (typeof v === 'number' ? v * 1000 : new Date(v).getTime());
        const live = tickets.filter(t => !t.hold_expires_at || toMs(t.hold_expires_at) > now);
        if (live.length === 0) return;

        // Only update if local cart is empty or has fewer items
        const existing = JSON.parse(localStorage.getItem('radford_cart') || '[]');
        const existingCount = existing.reduce((n, i) => n + (i.quantity || 1), 0);
        if (existingCount >= live.length) return;

        // Build minimal cart items for Nav badge count
        const grouped = {};
        live.forEach(t => {
          const eid = t.event_id;
          if (!grouped[eid]) {
            grouped[eid] = {
              id: eid, eventId: eid, event_id: eid,
              event_name: t.event_name || eid,
              fromVenuePage: true,
              seatKeys: [], seatTiers: [], ticketIds: [], seats: [],
              quantity: 0, price: 0, hold_id: t.hold_id,
            };
          }
          const g = grouped[eid];
          if (t.seat_key) g.seatKeys.push(t.seat_key);
          if (t.ticket_id) g.ticketIds.push(t.ticket_id);
          if (t.seat_key && t.tier) g.seatTiers.push({ seatKey: t.seat_key, tier: t.tier });
          g.quantity += 1;
        });

        localStorage.setItem('radford_cart', JSON.stringify(Object.values(grouped)));
        // Persist hold_id and expiry so Cart.jsx can reference them
        const holdId = live[0]?.hold_id;
        if (holdId) localStorage.setItem('radford_cart_id', holdId);
        // Only write expiry if one isn't already set — preserves the original
        // countdown from the reserving browser so login doesn't reset the timer.
        const earliest = live.map(t => t.hold_expires_at).filter(Boolean).sort()[0];
        if (earliest && !localStorage.getItem('radford_cart_expiry')) {
          const iso = typeof earliest === 'number' ? new Date(earliest * 1000).toISOString() : earliest;
          localStorage.setItem('radford_cart_expiry', iso);
        }
        // Notify Nav.jsx to update the badge count
        window.dispatchEvent(new Event('cartUpdated'));
      })
      .catch(() => {}); // Silently fail — Cart.jsx will do a full sync later
  }
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

async function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── SSO redirect ──────────────────────────────────────────────────────────────

/**
 * Redirects the browser to the Cognito Hosted UI to begin the PKCE auth flow.
 * The code verifier is saved in sessionStorage so exchangeCodeForTokens() can
 * use it when Cognito redirects back with the authorization code.
 *
 * @param {boolean} [isSignup=false] - Pass true to hint Cognito to show the
 *   sign-up screen rather than the sign-in screen.
 */
export async function initiateSSORedirect(isSignup = false) {
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  sessionStorage.setItem('pkce_code_verifier', codeVerifier);

  const params = new URLSearchParams({
    client_id:             COGNITO_CLIENT_ID,
    response_type:         'code',
    scope:                 'openid email profile',
    redirect_uri:          window.location.origin,
    code_challenge_method: 'S256',
    code_challenge:        codeChallenge,
  });
  if (isSignup) params.set('screen_hint', 'signup');

  window.location.href = `${COGNITO_BASE_URL}/oauth2/authorize?${params.toString()}`;
}

// ── SSO token exchange ────────────────────────────────────────────────────────

/**
 * Exchanges the Cognito authorization code for tokens. Called by App.jsx on
 * mount when a ?code= query param is detected in the URL after SSO redirect.
 *
 * @param {string} code - The authorization code from Cognito's redirect.
 * @returns {Promise<string>} The authenticated user's email.
 * @throws {Error} If the token exchange request fails.
 */
export async function exchangeCodeForTokens(code) {
  const codeVerifier = sessionStorage.getItem('pkce_code_verifier');

  const body = new URLSearchParams({
    grant_type:   'authorization_code',
    client_id:    COGNITO_CLIENT_ID,
    redirect_uri: window.location.origin,
    code,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  });

  const res = await fetch(`${COGNITO_BASE_URL}/oauth2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || 'SSO token exchange failed');
  }

  const data = await res.json();
  saveTokens({
    idToken:      data.id_token,
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
  });
  sessionStorage.removeItem('pkce_code_verifier');

  const decoded = decodeJwt(data.id_token);
  const email = decoded?.email || decoded?.['cognito:username'] || '';
  writeLocalStorageShims(data.access_token, email, decoded?.sub, data.id_token);

  // Fetch DynamoDB profile (Type, Role, photoUrl, etc.) and cache in localStorage
  // so Header and Nav can display the badge/role immediately after SSO login.
  try {
    const meRes = await fetch(`${API_BASE}/me`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: data.access_token, idToken: data.id_token }),
    });
    if (meRes.ok) {
      const meData = await meRes.json();
      const profile = meData.userProfile || meData;
      localStorage.setItem('userProfile', JSON.stringify(profile));
      window.dispatchEvent(new StorageEvent('storage', { key: 'userProfile' }));
    }
  } catch {
    // Profile fetch failure is non-fatal — badge just won't show until Profile page is visited
  }

  return email;
}

// ── Direct API login ──────────────────────────────────────────────────────────

/**
 * Authenticates via Team01's direct API login endpoint (username + password).
 * Use this for accounts created via apiSignup(), not Radford SSO accounts.
 *
 * @param {string} username - Username or email.
 * @param {string} password
 * @returns {Promise<string>} The authenticated user's email.
 * @throws {Error} If credentials are invalid or the request fails.
 */
export async function apiLogin(username, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');

  saveTokens({
    idToken:      data.idToken,
    accessToken:  data.accessToken,
    refreshToken: data.refreshToken,
    expiresIn:    data.expiresIn,
  });

  const decoded = decodeJwt(data.idToken);
  const email = decoded?.email || username;
  writeLocalStorageShims(data.accessToken, email, decoded?.sub, data.idToken);

  // Save the DynamoDB profile (Type, Role, photoUrl, etc.) so Nav.jsx
  // can show the Analytics tab and Header can show the role badge.
  // The Lambda returns this in the /login response — no extra API call needed.
  if (data.userProfile) {
    localStorage.setItem('userProfile', JSON.stringify(data.userProfile));
    window.dispatchEvent(new StorageEvent('storage', { key: 'userProfile' }));
  }

  return email;
}

// ── Direct API signup ─────────────────────────────────────────────────────────

/**
 * Creates a new account via Team01's signup endpoint, then auto-logs in.
 *
 * @param {{ username: string, email: string, password: string, displayName?: string, phoneNumber?: string }} fields
 * @returns {Promise<string>} The new user's email (from auto-login).
 * @throws {Error} If signup fails or the subsequent login fails.
 */
export async function apiSignup({ username, email, password, displayName, phoneNumber }) {
  const res = await fetch(`${API_BASE}/signup`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      username,
      email,
      password,
      displayName: displayName || username,
      phoneNumber: phoneNumber || undefined,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Signup failed');

  // Auto-login so the user lands directly on the app after creating their account
  return apiLogin(username, password);
}
