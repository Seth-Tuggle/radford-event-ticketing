/**
 * @file services/AuthService.js
 * @description Centralized authentication service for Team01 login/profile.
 *
 * Handles:
 *  - Token storage/retrieval/clearing in localStorage
 *  - User profile caching (from DynamoDB via /login and /me endpoints)
 *  - JWT decoding (no verification — client-side only)
 *  - PKCE helpers for SSO auth code flow via Cognito hosted UI
 *  - Profile fetching via POST /me (SSO fallback)
 *
 * localStorage keys written:
 *  - "idToken"         — Cognito ID token (contains email, sub, role claims)
 *  - "accessToken"     — Cognito access token (used for API authorization)
 *  - "refreshToken"    — Cognito refresh token
 *  - "tokenExpiresAt"  — Timestamp (ms) when the access token expires
 *  - "userProfile"     — JSON string of DynamoDB profile (Type, Role, etc.)
 *  - "token"           — Compat key for Team07 components (Nav, Header)
 *  - "userEmail"       — Compat key for Team07 Header display
 */

// ==================== CONFIG ====================
const API_BASE_URL =
  "https://service.example.invalid/Sprint2/Group-1";
const COGNITO_DOMAIN = "your-cognito-domain";
const COGNITO_REGION = "us-east-1";
const COGNITO_CLIENT_ID = "YOUR_CLIENT_ID";
const REDIRECT_URI = window.location.origin;
const COGNITO_BASE_URL = `https://${COGNITO_DOMAIN}.auth.${COGNITO_REGION}.amazoncognito.com`;

// ==================== TOKEN STORAGE ====================

function saveTokens(tokens) {
  if (tokens.idToken) localStorage.setItem("idToken", tokens.idToken);
  if (tokens.accessToken) localStorage.setItem("accessToken", tokens.accessToken);
  if (tokens.refreshToken) localStorage.setItem("refreshToken", tokens.refreshToken);
  if (tokens.expiresIn) {
    const expiresAt = Date.now() + tokens.expiresIn * 1000;
    localStorage.setItem("tokenExpiresAt", expiresAt.toString());
  }
  // Team07 compat: their Nav/Header check these keys
  if (tokens.idToken) localStorage.setItem("token", tokens.idToken);
}

function getTokens() {
  return {
    idToken: localStorage.getItem("idToken"),
    accessToken: localStorage.getItem("accessToken"),
    refreshToken: localStorage.getItem("refreshToken"),
    expiresAt: localStorage.getItem("tokenExpiresAt"),
  };
}

function clearTokens() {
  localStorage.removeItem("idToken");
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("tokenExpiresAt");
  localStorage.removeItem("userProfile");
  // Team07 compat keys
  localStorage.removeItem("token");
  localStorage.removeItem("userEmail");
}

function isTokenValid() {
  const { accessToken, expiresAt } = getTokens();
  if (!accessToken) return false;
  if (expiresAt && Date.now() > parseInt(expiresAt)) return false;
  return true;
}

// ==================== PROFILE STORAGE ====================

function saveProfile(profile) {
  if (profile) {
    localStorage.setItem("userProfile", JSON.stringify(profile));
    // Team07 compat: Header.jsx reads this
    const email = profile.Email || profile.email || "";
    if (email) localStorage.setItem("userEmail", email);
  }
}

function getSavedProfile() {
  try {
    const raw = localStorage.getItem("userProfile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ==================== JWT DECODE ====================

function decodeJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// ==================== PKCE HELPERS ====================

async function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ==================== API CALLS ====================

/**
 * Login via API — calls POST /login, returns tokens + userProfile from DynamoDB.
 */
async function apiLogin(username, password) {
  const res = await fetch(`${API_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Login failed");

  saveTokens({
    idToken: data.idToken,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresIn: data.expiresIn,
  });

  if (data.userProfile) {
    saveProfile(data.userProfile);
  }

  const decoded = decodeJwt(data.idToken);
  const email = decoded?.email || username;
  localStorage.setItem("userEmail", email);

  return { decoded, profile: data.userProfile || null, email };
}

/**
 * Signup via API — calls POST /signup, then auto-logs in.
 */
async function apiSignup({ username, email, password, displayName, phoneNumber }) {
  const res = await fetch(`${API_BASE_URL}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email,
      password,
      displayName: displayName || username,
      phoneNumber: phoneNumber || undefined,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Signup failed");

  return data;
}

/**
 * Fetch profile via POST /me — used by SSO flow (no /login call).
 * Also auto-creates a DynamoDB record if user is new (SSO signup).
 */
async function fetchUserProfile(accessToken, idToken) {
  try {
    const res = await fetch(`${API_BASE_URL}/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, idToken }),
    });

    if (!res.ok) {
      console.warn("POST /me failed:", res.status);
      return null;
    }

    const data = await res.json();
    const profile = data.userProfile || data;
    saveProfile(profile);
    return profile;
  } catch (err) {
    console.error("Error fetching user profile:", err);
    return null;
  }
}

// ==================== SSO HELPERS ====================

/**
 * Initiates SSO redirect to Cognito hosted UI.
 * Stores PKCE code verifier in sessionStorage (survives the redirect).
 */
async function initiateSSORedirect(isSignup = false) {
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  // Use sessionStorage for PKCE (needs to survive the redirect, clears on tab close)
  sessionStorage.setItem("pkce_code_verifier", codeVerifier);

  const endpoint = isSignup ? "signup" : "login";
  const ssoUrl =
    `${COGNITO_BASE_URL}/${endpoint}?` +
    new URLSearchParams({
      client_id: COGNITO_CLIENT_ID,
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: REDIRECT_URI,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
    }).toString();

  window.location.href = ssoUrl;
}

/**
 * Exchanges an SSO authorization code for tokens.
 * Called when the app detects ?code= in the URL after Cognito redirects back.
 */
async function exchangeCodeForTokens(code) {
  const codeVerifier = sessionStorage.getItem("pkce_code_verifier");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: COGNITO_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code: code,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  });

  const res = await fetch(`${COGNITO_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error_description || "Token exchange failed");
  }

  const data = await res.json();

  saveTokens({
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });

  sessionStorage.removeItem("pkce_code_verifier");

  const decoded = decodeJwt(data.id_token);
  const email = decoded?.email || decoded?.["cognito:username"] || "User";
  localStorage.setItem("userEmail", email);

  // Fetch DynamoDB profile (auto-creates for new SSO users)
  const profile = await fetchUserProfile(data.access_token, data.id_token);

  return { decoded, profile, email };
}

/**
 * Logout — clears all stored tokens and profile data.
 */
function logout() {
  clearTokens();
}

/**
 * Restore session — returns { email, profile, decoded } if valid session exists.
 */
function restoreSession() {
  if (!isTokenValid()) return null;

  const { idToken } = getTokens();
  const decoded = decodeJwt(idToken);
  if (!decoded) return null;

  const profile = getSavedProfile();
  const email = decoded.email || decoded["cognito:username"] || localStorage.getItem("userEmail") || "User";

  return { decoded, profile, email };
}

// ==================== EXPORTS ====================

const AuthService = {
  // Config
  API_BASE_URL,
  COGNITO_BASE_URL,
  COGNITO_CLIENT_ID,
  REDIRECT_URI,
  // Token management
  saveTokens,
  getTokens,
  clearTokens,
  isTokenValid,
  // Profile
  saveProfile,
  getSavedProfile,
  // JWT
  decodeJwt,
  // API calls
  apiLogin,
  apiSignup,
  fetchUserProfile,
  // SSO
  initiateSSORedirect,
  exchangeCodeForTokens,
  // Session
  logout,
  restoreSession,
};

export default AuthService;
