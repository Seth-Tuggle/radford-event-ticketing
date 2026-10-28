/**
 * @file components/UserAnalyticsPage.jsx
 * @description User analytics page with charts and date filters.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";

const SALES_URL = import.meta.env.VITE_TEAM3_GET_SALES_BY_DATE;
const USERS_BY_IDS_URL = import.meta.env.VITE_TEAM1_GET_BATCH_USERS;

function getRequiredEnvUrl(value, envName) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${envName}`);
  }
  return value;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstDefined(obj, keys, fallback = "") {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return fallback;
}

function normalizeId(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getSaleOwnerId(sale) {
  return normalizeId(
    firstDefined(
      sale,
      ["ownerId", "ownerID", "userId", "userID", "purchaserId", "purchaserID"],
      ""
    )
  );
}

function getUsersItems(usersData) {
  if (Array.isArray(usersData)) return usersData;
  if (Array.isArray(usersData?.users)) return usersData.users;
  if (Array.isArray(usersData?.items)) return usersData.items;
  if (Array.isArray(usersData?.Items)) return usersData.Items;

  if (typeof usersData?.body === "string") {
    try {
      const parsed = JSON.parse(usersData.body);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.users)) return parsed.users;
      if (Array.isArray(parsed?.items)) return parsed.items;
      if (Array.isArray(parsed?.Items)) return parsed.Items;
    } catch {
      return [];
    }
  }

  return [];
}

function getUserId(user) {
  return normalizeId(
    firstDefined(
      user,
      ["userId", "userID", "id", "ownerId", "ownerID", "Username", "username"],
      ""
    )
  );
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response.json();
}

async function getSalesByDate(startDate, endDate) {
  const salesUrl = getRequiredEnvUrl(SALES_URL, "VITE_TEAM3_GET_SALES_BY_DATE");
  const url = `${salesUrl}?dateFrom=${encodeURIComponent(
    startDate
  )}&dateTo=${encodeURIComponent(endDate)}`;

  return fetchJson(url);
}

async function getUsersByIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { users: [] };
  }

  const usersUrl = getRequiredEnvUrl(
    USERS_BY_IDS_URL,
    "VITE_TEAM1_GET_BATCH_USERS"
  );

  return fetchJson(usersUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds }),
  });
}

async function getUserAnalyticsData(startDate, endDate) {
  const salesData = await getSalesByDate(startDate, endDate);
  const rawSales = safeArray(salesData?.sales);

  const uniqueUserIds = [
    ...new Set(rawSales.map((sale) => getSaleOwnerId(sale)).filter(Boolean)),
  ];

  const ticketCounts = rawSales.reduce((counts, sale) => {
    const ownerId = getSaleOwnerId(sale);
    if (!ownerId) return counts;
    counts[ownerId] = (counts[ownerId] || 0) + 1;
    return counts;
  }, {});

  const usersData = await getUsersByIds(uniqueUserIds);
  const rawUsers = getUsersItems(usersData);

  const users = rawUsers.map((user) => {
    const userId = getUserId(user);

    return {
      userId,
      Username: firstDefined(user, ["Username", "username"], "N/A"),
      Age: firstDefined(user, ["Age", "age"], "N/A"),
      Gender: firstDefined(user, ["Gender", "gender"], "N/A"),
      GradYear: String(firstDefined(user, ["GradYear", "gradYear"], "N/A")),
      Type: firstDefined(user, ["Type", "type"], "N/A"),
      TimeZone: firstDefined(user, ["TimeZone", "timeZone"], "N/A"),
      ticketsBought: ticketCounts[userId] || 0,
    };
  });

  return {
    totalUsers: users.length,
    users,
  };
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function hasUsableValue(value) {
  if (!hasValue(value)) return false;
  const text = String(value).trim().toUpperCase();
  return text !== "N/A";
}

function hasValidAge(age) {
  const n = Number(age);
  return Number.isFinite(n) && n > 0;
}

function getAgeBucket(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  if (n <= 17) return "Under 18";
  if (n <= 22) return "18-22";
  if (n <= 27) return "23-27";
  if (n <= 34) return "28-34";
  if (n <= 44) return "35-44";
  if (n <= 54) return "45-54";
  if (n <= 64) return "55-64";
  return "65+";
}

function cssVar(name, fallback) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (value || "").trim() || fallback;
  } catch {
    return fallback;
  }
}

export default function UserAnalyticsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2027-12-31");
  const [appliedStart, setAppliedStart] = useState("2025-01-01");
  const [appliedEnd, setAppliedEnd] = useState("2027-12-31");
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1100 : false
  );

  const ageChartRef = useRef(null);
  const genderChartRef = useRef(null);
  const typeChartRef = useRef(null);
  const gradChartRef = useRef(null);

  const chartNavy = cssVar("--navy-accent", "#0d1b2a");
  const chartRed = cssVar("--radford-red", "#b11226");

  useEffect(() => {
    if (!startDate) return;
    const safeEnd = endDate && endDate >= startDate ? endDate : startDate;
    setAppliedStart(startDate);
    setAppliedEnd(safeEnd);
  }, [startDate, endDate]);

  useEffect(() => {
    async function loadUsers() {
      if (!appliedStart || !appliedEnd) return;

      try {
        setLoading(true);
        setError("");

        const result = await getUserAnalyticsData(appliedStart, appliedEnd);
        setData(Array.isArray(result?.users) ? result.users : []);
      } catch (err) {
        setError(err?.message || "Failed to load users");
        setData([]);
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  }, [appliedStart, appliedEnd]);

  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < 1100);

      if (ageChartRef.current) Plotly.Plots.resize(ageChartRef.current);
      if (genderChartRef.current) Plotly.Plots.resize(genderChartRef.current);
      if (typeChartRef.current) Plotly.Plots.resize(typeChartRef.current);
      if (gradChartRef.current) Plotly.Plots.resize(gradChartRef.current);
    };

    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleStartDateChange(value) {
    setStartDate(value);
    if (!value) return;
    if (!endDate || value > endDate) setEndDate(value);
  }

  function handleEndDateChange(value) {
    setEndDate(value);
    if (!value) return;
    if (!startDate || value < startDate) setStartDate(value);
  }

  const ageDistribution = useMemo(() => {
    const order = [
      "Under 18",
      "18-22",
      "23-27",
      "28-34",
      "35-44",
      "45-54",
      "55-64",
      "65+",
    ];
    const counts = {};

    for (const label of order) counts[label] = 0;

    for (const user of data) {
      if (!hasValidAge(user.Age)) continue;
      const bucket = getAgeBucket(user.Age);
      if (!bucket) continue;
      counts[bucket] = (counts[bucket] || 0) + 1;
    }

    return {
      labels: order,
      values: order.map((label) => counts[label] || 0),
    };
  }, [data]);

  const genderDistribution = useMemo(() => {
    const order = ["M", "F"];
    const counts = { M: 0, F: 0 };

    for (const user of data) {
      if (!hasValue(user.Gender)) continue;
      const normalized = String(user.Gender).trim().toUpperCase();
      if (normalized !== "M" && normalized !== "F") continue;
      counts[normalized] += 1;
    }

    return {
      labels: order,
      values: order.map((label) => counts[label] || 0),
    };
  }, [data]);

  const typeDistribution = useMemo(() => {
    const counts = {};

    for (const user of data) {
      if (!hasUsableValue(user.Type)) continue;
      const key = String(user.Type).trim();
      counts[key] = (counts[key] || 0) + 1;
    }

    const labels = Object.keys(counts).sort();

    return {
      labels,
      values: labels.map((label) => counts[label]),
    };
  }, [data]);

  const gradDistribution = useMemo(() => {
    const counts = {};

    for (const user of data) {
      if (!hasUsableValue(user.GradYear)) continue;
      const key = String(user.GradYear).trim();
      counts[key] = (counts[key] || 0) + 1;
    }

    const labels = Object.keys(counts).sort((a, b) => Number(a) - Number(b));

    return {
      labels,
      values: labels.map((label) => counts[label]),
    };
  }, [data]);

  useEffect(() => {
    if (!ageChartRef.current) return;

    Plotly.react(
      ageChartRef.current,
      [
        {
          x: ageDistribution.labels,
          y: ageDistribution.values,
          type: "bar",
          marker: { color: chartNavy },
          hovertemplate: "%{x}: %{y} users<extra></extra>",
        },
      ],
      {
        yaxis: { title: "Users", rangemode: "tozero", automargin: true },
        xaxis: { automargin: true, tickangle: -35 },
        plot_bgcolor: "rgba(255,255,255,0.92)",
        paper_bgcolor: "rgba(255,255,255,0.92)",
        margin: { t: 24, r: 20, l: 52, b: 135 },
      },
      { displayModeBar: false, responsive: true }
    );
  }, [ageDistribution, chartNavy, chartRed]);

  useEffect(() => {
    if (!genderChartRef.current) return;

    Plotly.react(
      genderChartRef.current,
      [
        {
          labels: genderDistribution.labels,
          values: genderDistribution.values,
          type: "pie",
          hole: 0.45,
          textinfo: "label+percent",
          marker: { colors: [chartNavy, chartRed] },
          hovertemplate: "%{label}: %{value} users<extra></extra>",
        },
      ],
      {
        plot_bgcolor: "rgba(255,255,255,0.92)",
        paper_bgcolor: "rgba(255,255,255,0.92)",
        margin: { t: 24, r: 20, l: 20, b: 30 },
        showlegend: true,
      },
      { displayModeBar: false, responsive: true }
    );
  }, [genderDistribution, chartNavy, chartRed]);

  useEffect(() => {
    if (!typeChartRef.current) return;

    Plotly.react(
      typeChartRef.current,
      [
        {
          x: typeDistribution.labels,
          y: typeDistribution.values,
          type: "bar",
          marker: { color: chartNavy },
          hovertemplate: "%{x}: %{y} users<extra></extra>",
        },
      ],
      {
        yaxis: { title: "Users", rangemode: "tozero", automargin: true },
        xaxis: { automargin: true, tickangle: -35 },
        plot_bgcolor: "rgba(255,255,255,0.92)",
        paper_bgcolor: "rgba(255,255,255,0.92)",
        margin: { t: 24, r: 20, l: 52, b: 135 },
      },
      { displayModeBar: false, responsive: true }
    );
  }, [typeDistribution, chartNavy, chartRed]);

  useEffect(() => {
    if (!gradChartRef.current) return;

    Plotly.react(
      gradChartRef.current,
      [
        {
          x: gradDistribution.labels,
          y: gradDistribution.values,
          type: "bar",
          marker: { color: chartNavy },
          hovertemplate: "Grad Year %{x}: %{y} users<extra></extra>",
        },
      ],
      {
        xaxis: {
          type: "category",
          title: "Graduation Year",
          automargin: true,
          tickangle: -35,
        },
        yaxis: {
          title: "Users",
          rangemode: "tozero",
          automargin: true,
        },
        plot_bgcolor: "rgba(255,255,255,0.92)",
        paper_bgcolor: "rgba(255,255,255,0.92)",
        margin: { t: 24, r: 20, l: 52, b: 135 },
      },
      { displayModeBar: false, responsive: true }
    );
  }, [gradDistribution, chartNavy, chartRed]);

  if (loading) {
    return (
      <>
        <style>{USER_ANALYTICS_PAGE_STYLES}</style>
        <div className="loading-state">⏳ Loading User Analytics...</div>
      </>
    );
  }

  return (
    <>
      <style>{USER_ANALYTICS_PAGE_STYLES}</style>

      <div className="user-analytics-layout">
        <div className="user-analytics-surface user-analytics-shell">
          <div className="user-analytics-header">
            <h3 className="ticket-title user-analytics-title">User Analytics</h3>
          </div>

          <div
            className={
              isNarrow
                ? "user-analytics-toolbar user-analytics-toolbar-single"
                : "user-analytics-toolbar"
            }
          >
            <label className="user-analytics-date-label">
              <span className="user-analytics-date-label-text">Start Date</span>
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => handleStartDateChange(event.target.value)}
                className="user-analytics-date-input"
              />
            </label>

            <label className="user-analytics-date-label">
              <span className="user-analytics-date-label-text">End Date</span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => handleEndDateChange(event.target.value)}
                className="user-analytics-date-input"
              />
            </label>
          </div>

          <div className="user-analytics-range-note">
            Showing users who have bought a ticket in <b>{appliedStart || "-"}</b>{" "}
            to <b>{appliedEnd || "-"}</b>.
          </div>

          {error ? <div className="user-analytics-error">Error: {error}</div> : null}
        </div>

        <div className="user-analytics-chart-wrap">
          <div
            className={
              isNarrow
                ? "user-analytics-chart-grid user-analytics-chart-grid-single"
                : "user-analytics-chart-grid"
            }
            >
              <div className="user-analytics-surface user-analytics-chart-card">
                <div className="user-analytics-chart-head">
                  <div>
                    <h4 className="ticket-title">Age Distribution</h4>
                    <p className="ticket-meta user-analytics-chart-meta">
                      Current purchaser totals by age range.
                    </p>
                  </div>
                </div>
                <div ref={ageChartRef} className="user-analytics-chart-canvas" />
              </div>

              <div className="user-analytics-surface user-analytics-chart-card">
                <div className="user-analytics-chart-head">
                  <div>
                    <h4 className="ticket-title">Gender Distribution</h4>
                    <p className="ticket-meta user-analytics-chart-meta">
                      Current purchaser mix by gender.
                    </p>
                  </div>
                </div>
                <div ref={genderChartRef} className="user-analytics-chart-canvas" />
              </div>

              <div className="user-analytics-surface user-analytics-chart-card">
                <div className="user-analytics-chart-head">
                  <div>
                    <h4 className="ticket-title">Users by Type</h4>
                    <p className="ticket-meta user-analytics-chart-meta">
                      Current purchaser totals by user type.
                    </p>
                  </div>
                </div>
                <div ref={typeChartRef} className="user-analytics-chart-canvas" />
              </div>

              <div className="user-analytics-surface user-analytics-chart-card">
                <div className="user-analytics-chart-head">
                  <div>
                    <h4 className="ticket-title">Graduation Analytics</h4>
                    <p className="ticket-meta user-analytics-chart-meta">
                      Current purchaser totals by graduation year.
                    </p>
                  </div>
                </div>
                <div ref={gradChartRef} className="user-analytics-chart-canvas" />
              </div>
            </div>
        </div>
      </div>
    </>
  );
}

const USER_ANALYTICS_PAGE_STYLES = `
.user-analytics-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.user-analytics-surface {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 0.9rem;
  border: 1px solid rgba(17, 24, 39, 0.06);
  border-radius: calc(var(--radius) - 2px);
  background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,250,251,0.96));
  box-shadow: 0 1px 6px rgba(15, 23, 42, 0.04);
  overflow: visible;
  box-sizing: border-box;
}

.user-analytics-shell {
  gap: 0.8rem;
}

.user-analytics-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.user-analytics-title {
  margin-bottom: 0;
}

.user-analytics-toolbar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 0.85rem;
  align-items: end;
}

.user-analytics-toolbar-single {
  grid-template-columns: 1fr;
}

.user-analytics-date-label {
  display: flex;
  flex-direction: column;
  gap: 0.24rem;
}

.user-analytics-date-label-text {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--neutral-grey);
}

.user-analytics-date-input {
  width: 100%;
  min-width: 0;
  padding: 0.58rem 0.78rem;
  border-radius: var(--radius);
  border: 1px solid var(--mountain-grey);
  background: rgba(255,255,255,0.96);
  font-size: 14px;
  font-family: inherit;
  color: var(--black);
  box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.04);
}

.user-analytics-date-input:focus {
  outline: none;
  border-color: var(--radford-red);
  box-shadow: 0 0 0 3px rgba(177, 18, 38, 0.14);
}

.user-analytics-range-note {
  color: var(--neutral-grey);
  font-size: 0.92rem;
}

.user-analytics-error {
  color: var(--radford-red);
  font-weight: 600;
}

.user-analytics-chart-wrap {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.user-analytics-chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  align-items: stretch;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.user-analytics-chart-grid-single {
  grid-template-columns: 1fr;
}

.user-analytics-chart-card {
  height: 100%;
}

.user-analytics-chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0.65rem;
  flex-wrap: wrap;
  min-height: 58px;
  padding-bottom: 0.1rem;
}

.user-analytics-chart-head > div:first-child {
  flex: 1 1 auto;
  min-width: 0;
}

.user-analytics-chart-head .ticket-title {
  font-size: 1rem;
  margin-bottom: 0.1rem;
}

.user-analytics-chart-meta {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.35;
}

.user-analytics-chart-canvas {
  width: 100%;
  height: 415px;
  min-height: 415px;
}

@media (max-width: 768px) {
  .user-analytics-toolbar,
  .user-analytics-chart-grid {
    grid-template-columns: 1fr;
  }

  .user-analytics-chart-canvas {
    height: 360px;
    min-height: 360px;
  }
}
`;
