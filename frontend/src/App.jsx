/**
 * @file App.jsx
 * @description Root application component — Team03 + Team07 + Team01 merged.
 *
 * Defines the top-level page layout that is shared across every route:
 *   - <Header>  — branding bar with the logged-in user's email (or a "Not
 *                 logged in" indicator when no session is active).
 *   - <Nav>     — navigation links and live cart-item count badge.
 *   - <main>    — content area rendered by the active route (see route map
 *                 below).
 *   - <footer>  — university copyright notice.
 *
 * Route map (all paths are client-side only — served from index.html):
 *   /                    → <EventBoard>           Browse and filter available events.
 *   /login               → <Login>                Sign-in / create-account form.
 *   /cart                → <Cart>                 Review selected tickets and check out.
 *   /mytickets           → <MyTickets>            View previously purchased tickets and QR codes.
 *   /transactionhistory  → <TransactionHistory>  View Stripe sandbox payment records.
 *   /profile             → <Profile>              View/edit user profile (Team01).
 *   /analytics           → <AnalyticsDashboard>   Staff + Analytics only (Team01).
 *
 * ── SSO callback handling ─────────────────────────────────────────────────────
 *   When a user signs in or signs up via Radford SSO (Cognito Hosted UI),
 *   Cognito redirects back to the app root (window.location.origin) with a
 *   ?code= query parameter. On mount, this component detects that code,
 *   exchanges it for tokens via auth.js, and navigates the user home.
 *
 *   All token storage and localStorage shim writing happens inside auth.js —
 *   this component only initiates the exchange and handles success/failure.
 *
 * The <BrowserRouter> context is provided by main.jsx, so no router setup is
 * needed here — only <Routes> / <Route> declarations.
 */
import { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { exchangeCodeForTokens } from './auth';
import Header from './components/Header';
import Nav from './components/Nav';
import Login from './components/Login';
import EventBoard from './components/EventBoard';
import Cart from './components/Cart';
import MyTickets from './components/MyTickets';
import TransactionHistory from './components/TransactionHistory';
import Profile from './components/Profile';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import Trending from "./components/Trending";
import CreateEvent from "./components/CreateEvent";

function App() {
  const navigate = useNavigate();

  let profile = null;
  try {
    profile = JSON.parse(localStorage.getItem("userProfile") || "null");
  } catch {
    profile = null;
  }

  const currentUserId =
    profile?.userId ||
    profile?.user_id ||
    profile?.UserID ||
    profile?.id ||
    localStorage.getItem("userSub") ||
    "";

  // ── SSO callback: Cognito redirects here with ?code= after authentication ──
  // Exchange the code for tokens, then strip the param and navigate home.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    // Remove ?code= from the URL immediately so a page refresh doesn't re-run
    window.history.replaceState({}, document.title, window.location.pathname);

    exchangeCodeForTokens(code)
      .then(() => {
        const returnTo = sessionStorage.getItem('radford_returnTo');
        sessionStorage.removeItem('radford_returnTo');
        if (returnTo && returnTo.startsWith('http')) {
          window.location.href = returnTo;
        } else {
          navigate(returnTo || '/');
        }
      })
      .catch(err => {
        console.error('SSO login failed:', err);
        navigate('/login');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      {/* Header handles SSO callback (?code=) and displays auth status */}
      <Header />
      <Nav />

      <main className="main-container">
        <div className="mountain-section">
          <Routes>
            <Route path="/" element={<EventBoard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/mytickets" element={<MyTickets />} />
            <Route path="/transactionhistory" element={<TransactionHistory />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/analytics" element={<AnalyticsDashboard />} />
            <Route path="/trending"  element={<Trending />} />
            <Route path="/create-event" element={<CreateEvent user_id={currentUserId} />} />
          </Routes>
        </div>
      </main>

      <footer className="footer">
        <p className="footer-text">&copy; 2026 Radford University</p>
        <p className="footer-subtext">CS472 Go Highlanders!</p>
      </footer>
    </div>
  );
}

export default App;
