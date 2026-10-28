/**
 * @file components/AnalyticsDashboard.jsx
 * @description Analytics page visible only to Staff members with Analytics role.
 *
 * Reads the user profile from localStorage. If the user doesn't have
 * Type="Staff" and Role="Analytics", shows an access denied message.
 * The nav link is also hidden (see Nav.jsx), but this serves as a
 * server-independent guard for direct URL access.
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import AnalyticsOverview from "./AnalyticsOverView";
import AnalyticsAttendance from "./AttendanceDashboard";
import AnalyticsRevenue from "./RevenueDashboard";
import UserAnalyticsPage from "./UserAnalyticsPage";
import EventSalesPage from "./EventSalesPage";
import SalesTrendsPage from "./SalesTrendsPage";

//used to handle rendering links to page dynamically
const analyticsNav = [
  { label: "📊 Annual Overview",   component: <AnalyticsOverview /> },
  { label: "🧾 Attendance", component: <AnalyticsAttendance /> },
  { label: "💵 Revenue",    component: <AnalyticsRevenue /> },
  { label: "👥 User Insights", component: <UserAnalyticsPage /> },
  { label: "🎟️ Sales by Event", component: <EventSalesPage /> },
  { label: "📈 Sales by Interval", component: <SalesTrendsPage /> },
];

export default function AnalyticsDashboard() {
  const [profile, setProfile] = useState(null);
  const [loaded, setLoaded] = useState(false);

  //keeps track of the active tabs. 
  const [activeTab, setActiveTab] = useState("📊 Annual Overview");

  const current = analyticsNav.find(t => t.label === activeTab);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("userProfile");
      if (raw) setProfile(JSON.parse(raw));
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const canView = profile && profile.Type === "Staff" && profile.Role === "Analytics";

  if (!loaded) return null;

  if (!canView) {
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <h2 style={{ color: "var(--radford-red)", marginBottom: "1rem" }}>🚫 Access Denied</h2>
        <p>You must be a Staff member with the Analytics role to view this page.</p>
        {profile && (
          <p style={{ marginTop: "0.5rem", color: "var(--neutral-grey)", fontSize: "0.9rem" }}>
            Your current profile — Type: <strong>{profile.Type || "N/A"}</strong>, Role: <strong>{profile.Role || "N/A"}</strong>
          </p>
        )}
        {!profile && (
          <p style={{ marginTop: "0.5rem", color: "var(--neutral-grey)", fontSize: "0.9rem" }}>
            Please <Link to="/login" style={{ color: "var(--radford-red)" }}>log in</Link> first.
          </p>
        )}
        <Link to="/" className="btn-primary" style={{ display: "inline-block", marginTop: "1rem" }}>
          Back to Events
        </Link>
      </div>
    );
  }

  const email = localStorage.getItem("userEmail") || "User";

  return (
    <>
      <h2 style={{ marginBottom: "1.5rem", color: "var(--radford-red)" }}>
        Analytics Dashboard
      </h2>
  
        <div>
          <div className="category-selector">
            {analyticsNav.map((item) => (
              <button
                key={item.label}
                onClick={() => setActiveTab(item.label)}
                className={activeTab === item.label ? "btn-primary" : "btn-accent"}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
  

      <div className="analytics-tab-content">
        {current.component}
      </div>

    </>
  );
}
