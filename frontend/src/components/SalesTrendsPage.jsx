/**
 * @file components/SalesTrendsPage.jsx
 * @description Sales trends analytics page with local start date, view mode, and event filtering.
 */
import Plotly from "plotly.js-dist-min";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INLINE_SALES_URL = import.meta.env.VITE_TEAM3_GET_SALES_BY_DATE;
const INLINE_EVENT_URL = import.meta.env.VITE_TEAM2_GET_EVENTS_BY_ID;

function getRequiredEnvUrl(value, envName) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${envName}`);
  }
  return value;
}

function inlineSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function inlineFirstDefined(obj, keys, fallback = "") {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return fallback;
}

function inlineNormalizeId(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function inlineIsCanceledEvent(event) {
  const status = String(inlineFirstDefined(event, ["status"], "")).toLowerCase();
  return status.includes("cancel");
}

function inlineGetEventId(event) {
  return inlineNormalizeId(
    inlineFirstDefined(event, ["event_id", "eventId", "id"], "")
  );
}

function inlineGetEventName(event) {
  return inlineFirstDefined(event, ["event_name", "title", "name"], "");
}

function inlineGetSaleEventId(sale) {
  return inlineNormalizeId(
    inlineFirstDefined(sale, ["eventId", "eventID", "event_id", "id"], "")
  );
}

function inlineBuildEventLookup(rawEvents) {
  const eventsMap = {};

  for (const event of rawEvents) {
    if (!event || typeof event !== "object") continue;

    const eventId = inlineGetEventId(event);
    if (eventId) {
      eventsMap[eventId] = event;
    }

    const arn = inlineNormalizeId(
      inlineFirstDefined(event, ["notification_ARN", "notificationArn"], "")
    );

    if (arn) {
      const suffix = arn.split(":").pop()?.trim();
      if (suffix) {
        eventsMap[suffix] = event;
      }
    }
  }

  return eventsMap;
}

function inlineResolveSaleEvent(sale, eventsMap) {
  const saleEventId = inlineGetSaleEventId(sale);
  if (!saleEventId) return null;
  return eventsMap[saleEventId] || null;
}

async function inlineFetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response.json();
}

async function inlineFetchSingleEventById(eventId) {
  const eventUrl = getRequiredEnvUrl(INLINE_EVENT_URL, "VITE_TEAM2_GET_EVENTS_BY_ID");
  const response = await fetch(`${eventUrl}${encodeURIComponent(eventId)}`);

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  if (typeof data?.body === "string") {
    try {
      return JSON.parse(data.body);
    } catch {
      return data;
    }
  }

  if (Array.isArray(data)) {
    return data[0] || null;
  }

  if (Array.isArray(data?.items)) {
    return data.items[0] || null;
  }

  if (Array.isArray(data?.Items)) {
    return data.Items[0] || null;
  }

  return data;
}

async function inlineGetSalesByDate(startDate, endDate) {
  const salesUrl = getRequiredEnvUrl(
    INLINE_SALES_URL,
    "VITE_TEAM3_GET_SALES_BY_DATE"
  );
  const url = `${salesUrl}?dateFrom=${encodeURIComponent(
    startDate
  )}&dateTo=${encodeURIComponent(endDate)}`;
  return inlineFetchJson(url);
}

async function inlineGetEvents(eventIds = []) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return [];
  }

  const uniqueEventIds = [...new Set(eventIds.filter(Boolean))];
  const chunkSize = 5;
  const results = [];

  for (let i = 0; i < uniqueEventIds.length; i += chunkSize) {
    const chunk = uniqueEventIds.slice(i, i + chunkSize);
    const events = await Promise.all(
      chunk.map((id) => inlineFetchSingleEventById(id))
    );
    results.push(...events.filter(Boolean));
  }

  return results;
}

function inlineGeneratePeriods(start, mode, count = 7) {
  const periods = [];
  let current = new Date(`${start}T00:00:00`);

  for (let i = 0; i < count; i += 1) {
    const next = new Date(current);

    switch (mode) {
      case "Daily":
        next.setDate(next.getDate() + 1);
        break;
      case "Weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "Monthly":
        next.setMonth(next.getMonth() + 1);
        break;
      case "Quarterly":
        next.setMonth(next.getMonth() + 3);
        break;
      case "Yearly":
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        next.setDate(next.getDate() + 1);
        break;
    }

    const bucketStart = current.toISOString().slice(0, 10);
    const bucketEndExclusive = next.toISOString().slice(0, 10);
    const bucketEndDisplay = new Date(next.getTime() - 1)
      .toISOString()
      .slice(0, 10);

    periods.push({
      label: `${bucketStart} -> ${bucketEndDisplay}`,
      startDate: bucketStart,
      endDate: bucketEndExclusive,
    });

    current = next;
  }

  return periods;
}

async function inlineGetInternalDashboardData(startDate, mode, count = 7) {
  const periods = inlineGeneratePeriods(startDate, mode, count);

  const allSalesResults = await Promise.all(
    periods.map(async (period) => {
      const salesData = await inlineGetSalesByDate(period.startDate, period.endDate);
      return {
        label: period.label,
        rawSales: inlineSafeArray(salesData?.sales),
      };
    })
  );

  const allEventIds = [
    ...new Set(
      allSalesResults
        .flatMap((period) =>
          period.rawSales.map((sale) => inlineGetSaleEventId(sale))
        )
        .filter(Boolean)
    ),
  ];

  const rawEvents = await inlineGetEvents(allEventIds);
  const eventsMap = inlineBuildEventLookup(rawEvents);
  const periodEventMap = {};
  const eventIds = new Set();

  for (const result of allSalesResults) {
    const eventMap = {};

    for (const sale of result.rawSales) {
      const matchedEvent = inlineResolveSaleEvent(sale, eventsMap);
      const eventId = matchedEvent ? inlineGetEventId(matchedEvent) : "";
      if (!eventId || !matchedEvent) continue;
      if (inlineIsCanceledEvent(matchedEvent)) continue;

      eventMap[eventId] = (eventMap[eventId] || 0) + 1;
      eventIds.add(eventId);
    }

    periodEventMap[result.label] = eventMap;
  }

  return {
    periodEventMap,
    availableEvents: Array.from(eventIds)
      .map((eventId) => {
        const event = eventsMap[eventId];
        if (!event || inlineIsCanceledEvent(event)) return null;

        return {
          id: eventId,
          label: inlineGetEventName(event) || eventId,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function getOneWeekAgoIso() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().slice(0, 10);
}

/**
 * Shared lightweight popover used by the Sales Trends filters.
 */
function SalesTrendsFilterPopover({
  id,
  label,
  valueText,
  isOpen,
  onToggle,
  onClose,
  children,
  menuClassName = "",
}) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={rootRef} className={`sales-filter-menu ${menuClassName}`.trim()}>
      <button
        type="button"
        className={`sales-filter-summary${isOpen ? " is-open" : ""}`}
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
      >
        <span className="sales-filter-summary-text">
          <span className="sales-filter-summary-label">{label}</span>
          <span className="sales-filter-summary-value">({valueText})</span>
        </span>
        <span
          className={`sales-filter-summary-chevron${
            isOpen ? " is-open" : ""
          }`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {isOpen && <div className="sales-filter-popover">{children}</div>}
    </div>
  );
}

/**
 * Time-series chart for the Sales Trends section.
 */
export default function SalesTrendsPage() {
  const [localStartDate, setLocalStartDate] = useState(getOneWeekAgoIso);
  const [viewMode, setViewMode] = useState("Daily");
  const [periodEventMap, setPeriodEventMap] = useState({});
  const [availableEvents, setAvailableEvents] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [activeFilterPopoverId, setActiveFilterPopoverId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const chartContainerRef = useRef(null);

  useEffect(() => {
    const resize = () => {
      if (chartContainerRef.current) {
        Plotly.Plots.resize(chartContainerRef.current);
      }
    };

    window.addEventListener("resize", resize, { passive: true });
    return () => window.removeEventListener("resize", resize);
  }, []);

  const loadTrendData = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await inlineGetInternalDashboardData(localStartDate, viewMode, 7);
      const nextPeriodEventMap = result?.periodEventMap || {};
      const nextAvailableEvents = Array.isArray(result?.availableEvents)
        ? result.availableEvents
        : [];
      const availableEventIds = nextAvailableEvents.map((event) => event.id);

      setPeriodEventMap(nextPeriodEventMap);
      setAvailableEvents(nextAvailableEvents);
      setSelectedEvents((current) =>
        current.length
          ? current.filter((id) => availableEventIds.includes(id))
          : availableEventIds
      );
    } catch {
      setPeriodEventMap({});
      setAvailableEvents([]);
      setSelectedEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [localStartDate, viewMode]);

  useEffect(() => {
    loadTrendData();
  }, [loadTrendData]);

  const filteredPeriodTotals = useMemo(() => {
    const totals = {};
    const selectedSet = new Set(selectedEvents);

    for (const [label, eventMap] of Object.entries(periodEventMap)) {
      if (selectedSet.size === 0) {
        totals[label] = 0;
        continue;
      }

      totals[label] = Object.entries(eventMap || {}).reduce((sum, [id, value]) => {
        return selectedSet.has(id) ? sum + (Number(value) || 0) : sum;
      }, 0);
    }

    return totals;
  }, [periodEventMap, selectedEvents]);

  useEffect(() => {
    if (!chartContainerRef.current || Object.keys(periodEventMap).length === 0) {
      return;
    }

    const labels = Object.keys(filteredPeriodTotals).map((label) => {
      const startRaw = label.split(" -> ")[0] || "";
      const [y, m, d] = startRaw.split("-");
      return y && m && d ? `${m}-${d}-${y.slice(2)}` : startRaw;
    });

    const values = Object.values(filteredPeriodTotals);
    const titleSuffix =
      selectedEvents.length === 0 ? `${viewMode} view, no events selected` : `${viewMode} view`;

    Plotly.react(
      chartContainerRef.current,
      [
        {
          x: labels,
          y: values,
          type: "bar",
          marker: { color: "#0d1b2a" },
          textposition: "none",
        },
      ],
      {
        title: {
          text: `<span style="font-size:16px;font-weight:600;color:#111827;">Tickets Sold</span><br><span style="font-size:12px;font-weight:400;color:#6b7280;">${titleSuffix}</span>`,
          font: { family: "Montserrat, sans-serif", size: 16, color: "#111827" },
          x: 0.5,
          xanchor: "center",
        },
        xaxis: {
          type: "category",
          categoryorder: "array",
          categoryarray: labels,
          color: "#111111",
          gridcolor: "#e2e2e2",
          tickfont: { family: "Montserrat, sans-serif", size: 10 },
          tickangle: 0,
          automargin: true,
        },
        yaxis: {
          color: "#111111",
          gridcolor: "#e2e2e2",
          tickfont: { family: "Montserrat, sans-serif", size: 10 },
          automargin: true,
        },
        plot_bgcolor: "rgba(255,255,255,0.92)",
        paper_bgcolor: "rgba(255,255,255,0.92)",
        font: { family: "Montserrat, sans-serif", color: "#111111" },
        margin: { t: 70, r: 30, l: 60, b: 70 },
      },
      {
        displayModeBar: false,
        responsive: true,
      }
    );
  }, [filteredPeriodTotals, periodEventMap, selectedEvents.length, viewMode]);

  const availableEventIds = useMemo(
    () => availableEvents.map((event) => event.id),
    [availableEvents]
  );

  const areAllEventsSelected =
    availableEventIds.length > 0 && selectedEvents.length === availableEventIds.length;

  function toggleAllEvents() {
    setSelectedEvents(areAllEventsSelected ? [] : availableEventIds);
  }

  function toggleEvent(id) {
    setSelectedEvents((current) =>
      current.includes(id) ? current.filter((eventId) => eventId !== id) : [...current, id]
    );
  }

  function toggleFilterPopover(id) {
    setActiveFilterPopoverId((current) => (current === id ? null : id));
  }

  function closeFilterPopover() {
    setActiveFilterPopoverId(null);
  }

  return (
    <>
      <style>{SALES_TRENDS_SECTION_STYLES}</style>

      <div className="sales-trends-layout">
        {isLoading ? (
          <div className="loading-state">⏳ Loading Sales by Interval analytics...</div>
        ) : (
          <>
            <div className="sales-trends-top-surface">
              <div className="sales-trends-top-header">
                <h3 className="ticket-title sales-trends-top-title">Sales by Interval</h3>
              </div>

              <div className="sales-trends-toolbar sales-trends-toolbar-compact">
                <div className="sales-trends-control-cell">
                  <label className="sales-trends-field-block sales-trends-field">
                    <span className="sales-trends-date-label-text">Start Date</span>
                    <input
                      type="date"
                      value={localStartDate}
                      onChange={(event) => setLocalStartDate(event.target.value)}
                      className="sales-trends-date-input"
                    />
                  </label>
                </div>

                <div className="sales-trends-control-cell">
                  <label className="sales-trends-field-block sales-trends-field">
                    <span className="sales-trends-date-label-text">View</span>
                    <select
                      value={viewMode}
                      onChange={(event) => setViewMode(event.target.value)}
                      className="dashboard-input sales-trends-control-input"
                    >
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>Monthly</option>
                      <option>Quarterly</option>
                      <option>Yearly</option>
                    </select>
                  </label>
                </div>

                <div className="sales-trends-control-cell sales-trends-filter-group">
                  <div className="sales-trends-field-block sales-trends-field">
                    <span className="sales-trends-date-label-text">Events</span>
                    <SalesTrendsFilterPopover
                      id="sales-trends-events"
                      label="Events"
                      valueText={`${selectedEvents.length}/${availableEventIds.length || 0}`}
                      isOpen={activeFilterPopoverId === "sales-trends-events"}
                      onToggle={toggleFilterPopover}
                      onClose={closeFilterPopover}
                      menuClassName="sales-filter-menu-wide sales-trends-filter-menu"
                    >
                      <div className="sales-scroll-list sales-scroll-list-compact">
                        {availableEvents.length === 0 ? (
                          <div className="event-filter-empty">No Events Loaded Yet.</div>
                        ) : (
                          <>
                            <label className="sales-check-row">
                              <input
                                type="checkbox"
                                checked={areAllEventsSelected}
                                onChange={toggleAllEvents}
                              />
                              <span>All Events</span>
                            </label>
                            {availableEvents.map((event) => (
                              <label key={event.id} className="sales-check-row">
                                <input
                                  type="checkbox"
                                  checked={selectedEvents.includes(event.id)}
                                  onChange={() => toggleEvent(event.id)}
                                />
                                <span>{event.label}</span>
                              </label>
                            ))}
                          </>
                        )}
                      </div>
                    </SalesTrendsFilterPopover>
                  </div>
                </div>
              </div>

              <div className="sales-trends-range-note">
                Showing ticket sales starting on <b>{localStartDate}</b> in{" "}
                <b>{viewMode.toLowerCase()}</b> view for{" "}
                <b>{selectedEvents.length}</b> selected events.
              </div>
            </div>

            <div className="sales-surface sales-trend-chart-panel">
              <div ref={chartContainerRef} className="sales-trend-chart-canvas" />
            </div>
          </>
        )}
      </div>
    </>
  );
}

const SALES_TRENDS_SECTION_STYLES = `
.dashboard-control-label {display: flex; flex-direction: column; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--neutral-grey); font-weight: 600; gap: 0.45rem;}
.dashboard-input {padding: 0.75rem 0.9rem; border-radius: var(--radius); border: 1px solid var(--mountain-grey); background: var(--white); font-size: 14px; font-family: inherit; color: var(--black); min-width: 180px; margin-bottom: 0; box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.04);}
.dashboard-input:focus {outline: none; border-color: var(--radford-red); box-shadow: 0 0 0 3px rgba(177, 18, 38, 0.14);}
.sales-trends-layout {display: flex; flex-direction: column; gap: 0.85rem;}
.sales-trends-top-surface {width: 100%; max-width: 100%; min-width: 0; height: auto; min-height: 0; flex: 0 0 auto; align-self: flex-start; display: flex; flex-direction: column; justify-content: flex-start; gap: 0.5rem; padding: 0.72rem 0.9rem 0.68rem; border: 1px solid rgba(17, 24, 39, 0.06); border-radius: calc(var(--radius) - 2px); background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,250,251,0.96)); box-shadow: 0 1px 6px rgba(15, 23, 42, 0.04); box-sizing: border-box;}
.sales-trends-top-header {display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap;}
.sales-trends-top-title {margin-bottom: 0;}
.sales-surface {min-width: 0; display: flex; flex-direction: column; gap: 0.75rem; padding: 0.85rem 0.9rem; border: 1px solid rgba(17, 24, 39, 0.06); border-radius: calc(var(--radius) - 2px); background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,250,251,0.96)); box-shadow: 0 1px 6px rgba(15, 23, 42, 0.04); overflow: visible;}
.sales-trends-toolbar {display: flex; flex-wrap: wrap; gap: 0.55rem; align-items: flex-end;}
.sales-trends-toolbar-compact {display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.55rem 0.85rem; align-items: start; height: auto; min-height: 0;}
.sales-trends-control-cell {min-width: 0; height: auto; min-height: 0; align-self: start;}
.sales-trends-field {width: 100%;}
.sales-trends-field-block {display: flex; flex-direction: column; justify-content: flex-start; gap: 0.18rem; width: 100%; height: auto; min-height: 0; flex: 0 0 auto;}
.sales-trends-field .dashboard-input {width: 100%; min-width: 0;}
.sales-trends-date-label-text {font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--neutral-grey);}
.sales-trends-date-input {width: 100%; min-width: 0; min-height: 42px; padding: 0.58rem 0.78rem; border-radius: var(--radius); border: 1px solid var(--mountain-grey); background: rgba(255,255,255,0.96); font-size: 14px; line-height: 1.2; font-family: inherit; color: var(--black); box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.04); box-sizing: border-box;}
.sales-trends-date-input:focus {outline: none; border-color: var(--radford-red); box-shadow: 0 0 0 3px rgba(177, 18, 38, 0.14);}
.sales-trends-range-note {grid-column: 1 / -1; margin-top: 0.1rem; color: var(--neutral-grey); font-size: 0.92rem;}
.sales-trends-filter-group {min-width: 0;}
.sales-trends-filter-group .sales-filter-menu {width: 100%; height: auto; min-height: 0; flex: 0 0 auto;}
.sales-trends-toolbar .dashboard-control-label {gap: 0.24rem; font-size: 0.72rem; width: 100%;}
.sales-trends-control-input {min-width: 0; min-height: 42px; padding: 0.58rem 0.78rem; line-height: 1.2; background: rgba(255,255,255,0.96); box-sizing: border-box;}
.sales-trends-filter-menu .sales-filter-summary {min-height: 42px; padding: 0.58rem 0.78rem; border-color: rgba(17, 24, 39, 0.08); background: rgba(255,255,255,0.96); font-size: 0.82rem; font-weight: 500; line-height: 1.2; box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.02); box-sizing: border-box;}
.sales-filter-menu {position: relative; min-width: 0;}
.sales-filter-menu-wide {flex: 1 1 220px;}
.sales-filter-summary {display: flex; align-items: center; justify-content: space-between; gap: 0.55rem; width: 100%; min-height: 34px; padding: 0.44rem 0.58rem; border: 1px solid rgba(17, 24, 39, 0.06); border-radius: calc(var(--radius) - 2px); background: rgba(255,255,255,0.94); color: var(--black); font-size: 0.77rem; font-weight: 600; cursor: pointer; box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.015); text-align: left; appearance: none; transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;}
.sales-filter-summary:hover {border-color: rgba(13, 27, 42, 0.14); background: rgba(255,255,255,0.98);}
.sales-filter-summary.is-open {border-color: rgba(13, 27, 42, 0.14); box-shadow: 0 0 0 2px rgba(13, 27, 42, 0.04);}
.sales-filter-summary-text {display: inline-flex; align-items: center; gap: 0.22rem; min-width: 0; flex-wrap: wrap;}
.sales-filter-summary-label {color: var(--black); font-weight: 600;}
.sales-filter-summary-value {display: inline-flex; align-items: center; padding: 0; border-radius: 0; background: transparent; color: var(--navy-accent); font-size: 0.72rem; font-weight: 700;}
.sales-filter-summary-chevron {display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--neutral-grey); font-size: 0.78rem; line-height: 1; transition: transform 0.18s ease, color 0.18s ease;}
.sales-filter-summary-chevron.is-open {transform: rotate(180deg); color: var(--navy-accent);}
.sales-filter-popover {position: absolute; top: calc(100% + 0.35rem); right: 0; z-index: 12; width: min(320px, calc(100vw - 5rem)); padding: 0.6rem 0.65rem; border: 1px solid rgba(17, 24, 39, 0.05); border-radius: calc(var(--radius) - 2px); background: rgba(255,255,255,0.98); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);}
.sales-scroll-list {max-height: 180px; overflow-y: auto; overflow-x: hidden; padding-right: 0.15rem;}
.sales-scroll-list-compact {max-height: 150px;}
.sales-check-row {display: grid; grid-template-columns: 18px minmax(0, 1fr); column-gap: 0.65rem; align-items: start; padding: 0.32rem 0; color: var(--black); cursor: pointer; line-height: 1.3;}
.sales-check-row input[type="checkbox"] {width: 16px; height: 16px; margin: 0.1rem 0 0; accent-color: var(--radford-red);}
.sales-check-row span {min-width: 0; overflow-wrap: anywhere; font-size: 0.84rem;}
.event-filter-empty {padding: 0.5rem 0; color: var(--neutral-grey); font-size: 0.9rem;}
.sales-trend-chart-panel {padding: 0.75rem 0.85rem;}
.sales-trend-chart-canvas {width: 100%; height: 470px;}

@media (max-width: 768px) {
  .sales-trends-toolbar-compact {grid-template-columns: 1fr;}
  .sales-toolbar-group {width: 100%;}
  .sales-filter-menu,
  .sales-filter-menu-wide {width: 100%;}
  .sales-filter-popover {left: 0; right: auto; width: min(100%, 320px);}
  .sales-trend-chart-canvas {height: 360px;}
}
`;
