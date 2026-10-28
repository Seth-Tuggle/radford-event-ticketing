/**
 * @file components/Login.jsx
 * @description Authentication page — visual layout and UX taken directly from
 * Team01's dev/src/App.jsx login view, integrated with our auth.js helpers.
 *
 * Layout:
 *   Two-column card: red gradient panel (left) + form panel (right).
 *
 * Form panel has two states:
 *   Default — "Join today." signup options + "Already have an account?" sign-in
 *             section with SSO and API login.
 *   Signup  — Full account creation form (username, email, display name, phone,
 *             password, confirm password) shown when "Create account" is clicked.
 *
 * Auth flows (all implemented in src/auth.js):
 *   SSO   — Redirects to Cognito Hosted UI via PKCE. Callback handled by App.jsx.
 *   API   — Direct username+password login via Team01's /Sprint2/Group-1/login.
 *   Signup — Account creation via Team01's /Sprint2/Group-1/signup, then auto-login.
 *
 * On success: tokens in sessionStorage + localStorage shims ("token","userEmail")
 * written by auth.js, then navigated home. Nav/Header/Cart need no changes.
 *
 * @see src/auth.js for token storage, PKCE, and API endpoint details.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { initiateSSORedirect, apiLogin, apiSignup } from "../auth";

/**
 * Login — two-column auth card matching Team01's design.
 *
 * @returns {JSX.Element}
 */
export default function Login() {
  const navigate = useNavigate();

  const [showSignupForm, setShowSignupForm] = useState(false);
  const [showApiLogin,   setShowApiLogin]   = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [authError,      setAuthError]      = useState("");
  const [authSuccess,    setAuthSuccess]    = useState("");

  const [signupData, setSignupData] = useState({
    username: "", displayName: "", email: "", phoneNumber: "",
    password: "", confirmPassword: "",
  });
  const [loginData, setLoginData] = useState({ username: "", password: "" });

  // Password visibility toggles
  const [showLoginPw, setShowLoginPw]     = useState(false);
  const [showSignupPw, setShowSignupPw]   = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const eyeBtn = (visible, toggle) => (
    <button
      type="button"
      onClick={toggle}
      style={{ position: "absolute", right: "0.75rem", top: "0", height: "calc(100% - 0.75rem)", display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", color: "var(--neutral-grey)", padding: "0" }}
      tabIndex={-1}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {visible ? (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        ) : (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSSOLogin  = () => initiateSSORedirect(false);
  const handleSSOSignup = () => initiateSSORedirect(true);

  /**
   * Navigates to the stored returnTo path (e.g. /cart after checkout redirect)
   * or falls back to the home page.
   */
  const navigateAfterAuth = () => {
    const returnTo = sessionStorage.getItem('radford_returnTo');
    sessionStorage.removeItem('radford_returnTo');
    if (returnTo && returnTo.startsWith('http')) {
      window.location.href = returnTo;
    } else {
      navigate(returnTo || "/");
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    if (signupData.password !== signupData.confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await apiSignup(signupData); // auto-logs in after signup
      navigateAfterAuth();
    } catch (err) {
      setAuthError(err.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleApiLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    setLoading(true);
    try {
      await apiLogin(loginData.username, loginData.password);
      navigateAfterAuth();
    } catch (err) {
      setAuthError(err.message || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="login-container">

      {/* ── Left panel: red gradient with R logo ── */}
      <div className="login-brand">
        <svg width="120" height="120" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="22" fill="white" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
          <text x="24" y="30" fontSize="20" fontWeight="bold" fill="#b11226" textAnchor="middle" fontFamily="serif">R</text>
        </svg>
      </div>

      {/* ── Right panel: forms ── */}
      <div className="login-form-panel">

        {/* Status messages */}
        {authError && (
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", fontSize: "0.9rem", marginBottom: "1rem" }}>
            {authError}
          </div>
        )}
        {authSuccess && (
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #86efac", color: "#16a34a", fontSize: "0.9rem", marginBottom: "1rem" }}>
            {authSuccess}
          </div>
        )}
        {loading && (
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "#eff6ff", border: "1px solid #93c5fd", color: "#2563eb", fontSize: "0.9rem", marginBottom: "1rem", textAlign: "center" }}>
            Loading...
          </div>
        )}

        {/* ── Signup section (default view) or Signup form ── */}
        {!showSignupForm ? (
          <>
            <h1 style={{ fontSize: "2rem", fontWeight: "800", color: "var(--black)", marginBottom: "2rem", letterSpacing: "-0.5px" }}>
              Join today.
            </h1>

            {/* Sign up with SSO */}
            <button
              onClick={handleSSOSignup}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", width: "100%", padding: "0.75rem", borderRadius: "9999px", border: "1.5px solid var(--mountain-grey)", background: "var(--white)", color: "var(--black)", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer", marginBottom: "1rem", transition: "var(--transition)", opacity: loading ? 0.6 : 1 }}
              onMouseOver={e => (e.currentTarget.style.background = "var(--light-grey)")}
              onMouseOut={e  => (e.currentTarget.style.background = "var(--white)")}
            >
              🏫 Sign up with SSO
            </button>

            {/* "or" divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "0.5rem 0 1rem", color: "var(--neutral-grey)", fontSize: "0.85rem" }}>
              <div style={{ flex: 1, height: "1px", background: "var(--mountain-grey)" }} />
              or
              <div style={{ flex: 1, height: "1px", background: "var(--mountain-grey)" }} />
            </div>

            {/* Create account → show signup form */}
            <button
              onClick={() => { setShowSignupForm(true); setAuthError(""); setAuthSuccess(""); }}
              style={{ width: "100%", padding: "0.75rem", borderRadius: "9999px", border: "none", background: "var(--radford-red)", color: "var(--white)", fontSize: "0.95rem", fontWeight: "700", cursor: "pointer", marginBottom: "2rem", transition: "var(--transition)" }}
              onMouseOver={e => (e.currentTarget.style.background = "var(--radford-red-dark)")}
              onMouseOut={e  => (e.currentTarget.style.background = "var(--radford-red)")}
            >
              Create account
            </button>

            {/* ── Sign in section ── */}
            <p style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--black)", marginBottom: "1rem" }}>
              Already have an account?
            </p>

            {/* Sign in with SSO */}
            <button
              onClick={handleSSOLogin}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", width: "100%", padding: "0.75rem", borderRadius: "9999px", border: "1.5px solid var(--mountain-grey)", background: "var(--white)", color: "var(--black)", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.75rem", transition: "var(--transition)", opacity: loading ? 0.6 : 1 }}
              onMouseOver={e => (e.currentTarget.style.background = "var(--light-grey)")}
              onMouseOut={e  => (e.currentTarget.style.background = "var(--white)")}
            >
              🏫 Sign in with SSO
            </button>

            {/* Sign in with API → toggle API login form */}
            <button
              onClick={() => { setShowApiLogin(!showApiLogin); setAuthError(""); }}
              style={{ width: "100%", padding: "0.75rem", borderRadius: "9999px", border: "1.5px solid var(--mountain-grey)", background: "var(--white)", color: "var(--black)", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer", transition: "var(--transition)" }}
              onMouseOver={e => (e.currentTarget.style.background = "var(--light-grey)")}
              onMouseOut={e  => (e.currentTarget.style.background = "var(--white)")}
            >
              🔑 Sign in with API
            </button>

            {/* API Login form (toggled) */}
            {showApiLogin && (
              <div style={{ marginTop: "1rem" }}>
                <form onSubmit={handleApiLogin}>
                  <input
                    type="text"
                    placeholder="Username"
                    value={loginData.username}
                    onChange={e => setLoginData({ ...loginData, username: e.target.value })}
                    required
                    style={{ borderRadius: "4px", marginBottom: "0.75rem" }}
                  />
                  <div style={{ position: "relative" }}>
                    <input
                      type={showLoginPw ? "text" : "password"}
                      placeholder="Password"
                      value={loginData.password}
                      onChange={e => setLoginData({ ...loginData, password: e.target.value })}
                      required
                      style={{ borderRadius: "4px", marginBottom: "0.75rem", paddingRight: "2.5rem" }}
                    />
                    {eyeBtn(showLoginPw, () => setShowLoginPw(!showLoginPw))}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{ width: "100%", padding: "0.75rem", borderRadius: "9999px", border: "none", background: "var(--navy-accent)", color: "var(--white)", fontSize: "0.95rem", fontWeight: "700", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}
                  >
                    {loading ? "Signing in..." : "Sign in"}
                  </button>
                </form>
              </div>
            )}
          </>
        ) : (
          /* ── Signup form ── */
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <button
                onClick={() => { setShowSignupForm(false); setAuthError(""); }}
                style={{ width: "36px", height: "36px", borderRadius: "50%", background: "var(--light-grey)", border: "1.5px solid var(--mountain-grey)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "var(--transition)" }}
                onMouseOver={e => (e.currentTarget.style.background = "var(--mountain-grey)")}
                onMouseOut={e  => (e.currentTarget.style.background = "var(--light-grey)")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--black)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <h1 style={{ fontSize: "1.75rem", fontWeight: "800", color: "var(--black)" }}>
                Create your account
              </h1>
            </div>

            <form onSubmit={handleSignup}>
              <input
                type="text"
                placeholder="Username *"
                value={signupData.username}
                onChange={e => setSignupData({ ...signupData, username: e.target.value })}
                required
                minLength={3}
                maxLength={20}
                pattern="^[a-zA-Z0-9_\-]{3,20}$"
                title="3-20 characters: letters, numbers, underscores, hyphens"
                style={{ borderRadius: "4px", marginBottom: "0.75rem" }}
              />
              <input
                type="text"
                placeholder="Display Name"
                value={signupData.displayName}
                onChange={e => setSignupData({ ...signupData, displayName: e.target.value })}
                style={{ borderRadius: "4px", marginBottom: "0.75rem" }}
              />
              <input
                type="email"
                placeholder="Email address *"
                value={signupData.email}
                onChange={e => setSignupData({ ...signupData, email: e.target.value })}
                required
                style={{ borderRadius: "4px", marginBottom: "0.75rem" }}
              />
              <input
                type="tel"
                placeholder="Phone number (optional, e.g. +1234567890)"
                value={signupData.phoneNumber}
                onChange={e => setSignupData({ ...signupData, phoneNumber: e.target.value })}
                style={{ borderRadius: "4px", marginBottom: "0.75rem" }}
              />
              <div style={{ position: "relative" }}>
                <input
                  type={showSignupPw ? "text" : "password"}
                  placeholder="Password *"
                  value={signupData.password}
                  onChange={e => setSignupData({ ...signupData, password: e.target.value })}
                  required
                  minLength={8}
                  style={{ borderRadius: "4px", marginBottom: "0.75rem", paddingRight: "2.5rem" }}
                />
                {eyeBtn(showSignupPw, () => setShowSignupPw(!showSignupPw))}
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type={showConfirmPw ? "text" : "password"}
                  placeholder="Confirm password *"
                  value={signupData.confirmPassword}
                  onChange={e => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                  required
                  style={{ borderRadius: "4px", marginBottom: "1rem", paddingRight: "2.5rem" }}
                />
                {eyeBtn(showConfirmPw, () => setShowConfirmPw(!showConfirmPw))}
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{ width: "100%", padding: "0.75rem", borderRadius: "9999px", border: "none", background: "var(--radford-red)", color: "var(--white)", fontSize: "0.95rem", fontWeight: "700", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, marginBottom: "1rem" }}
              >
                {loading ? "Creating account..." : "Sign up"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
