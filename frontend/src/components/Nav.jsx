/**
 * @file components/Nav.jsx
 * @description Navigation bar with live cart badge and conditional Analytics tab.
 *
 * Shows "Analytics Dashboard" link only when the logged-in user has
 * Type="Staff" and Role="Analytics" in their DynamoDB profile.
 *
 * localStorage keys consumed:
 *  - "radford_cart" — cart items array (for badge count)
 *  - "token"        — auth token presence = logged in
 *  - "userProfile"  — JSON profile with Type and Role fields
 */
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

function getCartCount() {
  try {
    const cart = JSON.parse(localStorage.getItem("radford_cart") || "[]");
    return cart.reduce((n, item) => n + (item.quantity || 1), 0);
  } catch {
    return 0;
  }
}

function getProfile() {
  try {
    const raw = localStorage.getItem("userProfile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Nav() {
  const location = useLocation();
  const [cartCount, setCartCount] = useState(getCartCount);

  // Determine login state synchronously at render time from localStorage.
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => !!localStorage.getItem("token"),
  );
  const [profile, setProfile] = useState(getProfile);

  // Derived permissions from the cached profile.
  const canViewAnalytics =
    profile && profile.Type === "Staff" && profile.Role === "Analytics";

  const canCreateEvents =
    profile && (profile.Role === "Staff" || profile.Role === "Analytics");

  // Listen for localStorage changes triggered by other pages (e.g. venue.html)
  // or other tabs. The "storage" event does NOT fire for writes made by the
  // current tab, so Cart.jsx dispatches a "cartUpdated" custom event instead.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "radford_cart") setCartCount(getCartCount());
      if (e.key === "token") setIsLoggedIn(!!localStorage.getItem("token"));
      if (e.key === "token" || e.key === "userProfile") setProfile(getProfile());
    };
    const onCartUpdated = () => {
      setCartCount(getCartCount());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("cartUpdated", onCartUpdated);
    // Cleanup: remove listeners when the component unmounts to prevent memory leaks
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cartUpdated", onCartUpdated);
    };
  }, []);

  const navLink = (to, label) => (
    <Link
      to={to}
      className={`nav-btn${location.pathname === to ? " active" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-buttons">
          {navLink("/", "🏆 Browse Events")}
          {navLink("/trending", "🔥 Top Events")}
          {navLink("/cart", `🛒 Cart (${cartCount})`)}
          {navLink("/mytickets", "🎫 My Tickets")}
          {navLink("/transactionhistory", "🧾 Transaction History")}

          {/* Analytics — only for Staff with Analytics role */}
          {canViewAnalytics && navLink("/analytics", "📊 Analytics Dashboard")}
          {canCreateEvents && navLink("/create-event", "➕ Create Event")}

          {/* Login — hidden when authenticated */}
          {!isLoggedIn && navLink("/login", "🔐 Login")}
        </div>
      </div>
    </nav>
  );
}
