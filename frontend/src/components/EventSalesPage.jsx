/**
 * @file components/EventSalesPage.jsx
 * @description Event sales page with date filters, event list, and comparison charts.
 */
import Plotly from "plotly.js-dist-min";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function uniqueSorted(values) {
  const set = new Set();
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value) continue;
    set.add(value);
  }
  return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
}

function formatTime12(timeStr) {
  if (!timeStr) return "";

  const [h, m] = String(timeStr).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(timeStr);

  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function shortChartLabel(label) {
  const text = String(label || "");
  return text.length > 18 ? `${text.slice(0, 15)}...` : text;
}

function resizePlot(containerRef) {
  if (containerRef.current) {
    Plotly.Plots.resize(containerRef.current);
  }
}

function renderSalesBarChart(chartContainer, chartRows) {
  return Plotly.react(
    chartContainer,
    [
      {
        x: chartRows.map((row) => shortChartLabel(row.key)),
        y: chartRows.map((row) => row.sold),
        customdata: chartRows.map((row) => row.key),
        type: "bar",
        marker: { color: "#0d1b2a" },
        hovertemplate: "%{customdata}: %{y} tickets<extra></extra>",
      },
    ],
    {
      yaxis: { title: "Tickets Sold", rangemode: "tozero", automargin: true },
      xaxis: { automargin: true, tickangle: -35 },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 24, r: 20, l: 52, b: 135 },
    },
    {
      displayModeBar: false,
      responsive: true,
    }
  );
}

function isUnknownType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "unknown" ||
    normalized === "unknown category"
  );
}

function getEventTypes(typeValue) {
  const sourceValues = Array.isArray(typeValue)
    ? typeValue
    : String(typeValue || "").split(",");

  const seen = new Set();
  const cleaned = [];

  for (const value of sourceValues) {
    const trimmed = String(value || "").trim();
    if (!trimmed || isUnknownType(trimmed)) continue;

    const normalizedKey = trimmed.toLowerCase();
    if (seen.has(normalizedKey)) continue;

    seen.add(normalizedKey);
    cleaned.push(trimmed);
  }

  return cleaned;
}

// Event sales API helpers stay local to this section.
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

function inlineSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function inlineGetEventId(event) {
  return inlineNormalizeId(
    inlineFirstDefined(event, ["event_id", "eventId", "id"], "")
  );
}

function inlineGetSaleEventId(sale) {
  return inlineNormalizeId(
    inlineFirstDefined(sale, ["eventId", "eventID", "event_id", "id"], "")
  );
}

function inlineGetEventDateValue(event) {
  return inlineFirstDefined(
    event,
    ["start_date_time", "event_date", "date_time", "date"],
    ""
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

function inlineFormatDateOnly(dateTimeString) {
  if (!dateTimeString) return "";
  return String(dateTimeString).slice(0, 10);
}

function inlineFormatTimeOnly(dateTimeString) {
  if (!dateTimeString) return "";
  const text = String(dateTimeString);
  if (text.includes("T")) {
    return text.split("T")[1]?.slice(0, 5) || "";
  }
  return "";
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

async function inlineGetAnalyticsBaseData(startDate, endDate) {
  const salesData = await inlineGetSalesByDate(startDate, endDate);

  const rawSales = inlineSafeArray(salesData?.sales).filter(
    (sale) => inlineGetSaleEventId(sale)
  );

  const eventIds = [
    ...new Set(rawSales.map((sale) => inlineGetSaleEventId(sale)).filter(Boolean)),
  ];
  const rawEvents = await inlineGetEvents(eventIds);
  const eventsMap = inlineBuildEventLookup(rawEvents);

  return {
    rawSales,
    eventsMap,
  };
}

async function inlineGetNormalizedSalesEvents(startDate, endDate) {
  const { rawSales, eventsMap } = await inlineGetAnalyticsBaseData(startDate, endDate);
  const eventSummaryMap = {};

  for (const sale of rawSales) {
    const matchedEvent = inlineResolveSaleEvent(sale, eventsMap);
    if (!matchedEvent) continue;

    const eventId = inlineGetEventId(matchedEvent) || inlineGetSaleEventId(sale);
    if (!eventId) continue;

    if (!eventSummaryMap[eventId]) {
      const rawDateValue = inlineGetEventDateValue(matchedEvent);
      const seatCount = inlineSafeNumber(
        inlineFirstDefined(matchedEvent, ["seat_count", "seatCount"], 0)
      );
      const categories = matchedEvent.categories;
      const parsedTypes = getEventTypes(categories);

      eventSummaryMap[eventId] = {
        eventID: eventId,
        name: inlineFirstDefined(
          matchedEvent,
          ["event_name", "title", "name"],
          "Unknown Event"
        ),
        date: inlineFormatDateOnly(rawDateValue),
        time: inlineFormatTimeOnly(rawDateValue),
        venue: inlineFirstDefined(
          matchedEvent,
          ["venue_name", "venue", "location"],
          "Unknown Venue"
        ),
        type: parsedTypes.length > 0 ? parsedTypes.join(", ") : "Unknown Category",
        sold: 0,
        available: seatCount,
      };
    }

    eventSummaryMap[eventId].sold += 1;
  }

  return Object.values(eventSummaryMap).map((event) => {
    const sold = inlineSafeNumber(event.sold);
    const available = Math.max(inlineSafeNumber(event.available) - sold, 0);
    return { ...event, sold, available };
  });
}

async function inlineGetSalesDashboardData(startDate, endDate) {
  const events = await inlineGetNormalizedSalesEvents(startDate, endDate);

  let sold = 0;
  let unsold = 0;
  const byType = {};
  const byVenue = {};

  for (const event of events) {
    sold += inlineSafeNumber(event.sold);
    unsold += inlineSafeNumber(event.available);

    const venueKey = event.venue || "Unknown";

    byVenue[venueKey] = (byVenue[venueKey] || 0) + inlineSafeNumber(event.sold);

    const eventTypes = getEventTypes(event.type);
    for (const typeKey of eventTypes) {
      byType[typeKey] = (byType[typeKey] || 0) + inlineSafeNumber(event.sold);
    }
  }

  const total = sold + unsold;

  return {
    events,
    summary: {
      events: events.length,
      sold,
      unsold,
      sellThrough: total > 0 ? Math.round((sold / total) * 100) : 0,
    },
    byType,
    byVenue,
  };
}

/**
 * Shared lightweight popover used by the Event Sales filters.
 */
function EventSalesFilterPopover({
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
 * Event-based sales tools for the selected date range.
 */
export default function EventSalesPage() {
  const DEFAULT_START = "2008-08-01";
  const DEFAULT_END = "2027-12-31";

  const [startDate, setStartDate] = useState(DEFAULT_START);
  const [endDate, setEndDate] = useState(DEFAULT_END);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [selectedChartTypes, setSelectedChartTypes] = useState();
  const [selectedChartVenues, setSelectedChartVenues] = useState();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [openFilterId, setOpenFilterId] = useState(null);
  const typeChartContainerRef = useRef(null);
  const venueChartContainerRef = useRef(null);

  const loadSalesData = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage("");
      const data = await inlineGetSalesDashboardData(startDate, endDate);
      const nextEvents = Array.isArray(data?.events) ? data.events : [];

      setEvents(nextEvents);
      setSelectedEventId((current) => {
        if (!nextEvents.length) return "";
        if (current && nextEvents.some((event) => event.eventID === current)) {
          return current;
        }
        return nextEvents[0].eventID;
      });
    } catch (err) {
      setErrorMessage(err?.message || "Failed to load sales summary.");
      setEvents([]);
      setSelectedEventId("");
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadSalesData();
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [loadSalesData]);

  function handleStartDateChange(value) {
    if (endDate && value > endDate) return;
    setStartDate(value);
  }

  function handleEndDateChange(value) {
    if (startDate && value < startDate) return;
    setEndDate(value);
  }

  const typeOptions = useMemo(
    () => uniqueSorted(events.flatMap((event) => getEventTypes(event.type))),
    [events]
  );

  const venueOptions = useMemo(
    () => uniqueSorted(events.map((event) => event.venue)),
    [events]
  );

  const filteredEvents = useMemo(() => {
    const nextEvents = events.filter((event) => {
      const eventTypes = getEventTypes(event.type);

      if (typeFilter && !eventTypes.includes(typeFilter)) return false;
      if (venueFilter && event.venue !== venueFilter) return false;
      return true;
    });

    nextEvents.sort((a, b) => {
      const left = `${a.date || ""}T${a.time || ""}`;
      const right = `${b.date || ""}T${b.time || ""}`;
      return left.localeCompare(right);
    });

    return nextEvents;
  }, [events, typeFilter, venueFilter]);

  const typeChartRows = useMemo(() => {
    const totals = {};

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      const soldCount = Number(event.sold) || 0;
      const eventTypes = getEventTypes(event.type);

      for (const key of eventTypes) {
        totals[key] = (totals[key] || 0) + soldCount;
      }
    }

    return Object.keys(totals)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({ key, sold: totals[key] }));
  }, [events]);

  const venueChartRows = useMemo(() => {
    const totals = {};

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      const key = event.venue || "Unknown Venue";
      totals[key] = (totals[key] || 0) + (Number(event.sold) || 0);
    }

    return Object.keys(totals)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({ key, sold: totals[key] }));
  }, [events]);

  const typeChartKeys = useMemo(
    () => typeChartRows.map((row) => row.key),
    [typeChartRows]
  );

  const venueChartKeys = useMemo(
    () => venueChartRows.map((row) => row.key),
    [venueChartRows]
  );

  useEffect(() => {
    setSelectedChartTypes((current) => {
      if (current === undefined) {
        return typeChartKeys.length > 0 ? [...typeChartKeys] : undefined;
      }
      return current.filter((item) => typeChartKeys.includes(item));
    });
  }, [typeChartKeys]);

  useEffect(() => {
    setSelectedChartVenues((current) => {
      if (current === undefined) {
        return venueChartKeys.length > 0 ? [...venueChartKeys] : undefined;
      }
      return current.filter((item) => venueChartKeys.includes(item));
    });
  }, [venueChartKeys]);

  const effectiveSelectedChartTypes = useMemo(() => {
    if (selectedChartTypes === undefined) return typeChartKeys;
    return selectedChartTypes.filter((item) => typeChartKeys.includes(item));
  }, [selectedChartTypes, typeChartKeys]);

  const effectiveSelectedChartVenues = useMemo(() => {
    if (selectedChartVenues === undefined) return venueChartKeys;
    return selectedChartVenues.filter((item) => venueChartKeys.includes(item));
  }, [selectedChartVenues, venueChartKeys]);

  const filteredTypeChartRows = useMemo(() => {
    const selected = new Set(effectiveSelectedChartTypes);
    return typeChartRows.filter((row) => selected.has(row.key));
  }, [typeChartRows, effectiveSelectedChartTypes]);

  const filteredVenueChartRows = useMemo(() => {
    const selected = new Set(effectiveSelectedChartVenues);
    return venueChartRows.filter((row) => selected.has(row.key));
  }, [venueChartRows, effectiveSelectedChartVenues]);

  const allChartTypesSelected =
    typeChartKeys.length > 0 &&
    effectiveSelectedChartTypes.length === typeChartKeys.length;
  const allChartVenuesSelected =
    venueChartKeys.length > 0 &&
    effectiveSelectedChartVenues.length === venueChartKeys.length;

  const selectedEvent =
    events.find((event) => event.eventID === selectedEventId) || null;

  const selectedEventSold = Number(selectedEvent?.sold) || 0;
  const selectedEventUnsold = Math.max(Number(selectedEvent?.available) || 0, 0);
  const selectedEventTotal = selectedEventSold + selectedEventUnsold;
  const selectedEventSellThrough =
    selectedEventTotal > 0
      ? Math.round((selectedEventSold / selectedEventTotal) * 100)
      : 0;

  function toggleAllChartTypes() {
    setSelectedChartTypes(allChartTypesSelected ? [] : [...typeChartKeys]);
  }

  function toggleChartType(type) {
    setSelectedChartTypes((current) => {
      const base =
        current === undefined
          ? [...typeChartKeys]
          : current.filter((item) => typeChartKeys.includes(item));

      return base.includes(type)
        ? base.filter((item) => item !== type)
        : [...base, type];
    });
  }

  function toggleAllChartVenues() {
    setSelectedChartVenues(allChartVenuesSelected ? [] : [...venueChartKeys]);
  }

  function toggleChartVenue(venue) {
    setSelectedChartVenues((current) => {
      const base =
        current === undefined
          ? [...venueChartKeys]
          : current.filter((item) => venueChartKeys.includes(item));

      return base.includes(venue)
        ? base.filter((item) => item !== venue)
        : [...base, venue];
    });
  }

  function toggleFilterPopover(id) {
    setOpenFilterId((current) => (current === id ? null : id));
  }

  function closeFilterPopover() {
    setOpenFilterId(null);
  }

  useEffect(() => {
    if (!typeChartContainerRef.current) return;

    renderSalesBarChart(typeChartContainerRef.current, filteredTypeChartRows);

    requestAnimationFrame(() => {
      resizePlot(typeChartContainerRef);
    });
  }, [filteredTypeChartRows]);

  useEffect(() => {
    if (!venueChartContainerRef.current) return;

    renderSalesBarChart(venueChartContainerRef.current, filteredVenueChartRows);

    requestAnimationFrame(() => {
      resizePlot(venueChartContainerRef);
    });
  }, [filteredVenueChartRows]);

  useEffect(() => {
    function handleResize() {
      resizePlot(typeChartContainerRef);
      resizePlot(venueChartContainerRef);
    }

    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      <style>{EVENT_SALES_SECTION_STYLES}</style>

      {errorMessage && (
        <div className="ticket-card">
          <p className="sales-simple-error">{errorMessage}</p>
        </div>
      )}

      {isLoading ? (
        <div className="loading-state">⏳ Loading Sales by Event analytics...</div>
      ) : (
        <div className="sales-dashboard-layout">
          <div className="sales-top-surface">
            <div className="sales-top-header">
              <h3 className="ticket-title sales-top-title">Sales by Event</h3>
            </div>

            <div className="sales-top-toolbar sales-top-toolbar-double">
              <label className="sales-top-date-label">
                <span className="sales-top-date-label-text">Start Date</span>
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(event) => handleStartDateChange(event.target.value)}
                  className="sales-top-date-input"
                />
              </label>

              <label className="sales-top-date-label">
                <span className="sales-top-date-label-text">End Date</span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(event) => handleEndDateChange(event.target.value)}
                  className="sales-top-date-input"
                />
              </label>
            </div>

            <div className="sales-top-range-note">
              Showing ticket sales for events from <b>{startDate}</b> to <b>{endDate}</b>.
            </div>
          </div>

          <div className="sales-panels sales-dashboard-row">
            <section className="sales-surface sales-panel sales-selector-panel">
              <div className="sales-panel-header sales-surface-header">
                <div>
                  <div className="sales-panel-title-row">
                    <h4 className="ticket-title">Events</h4>
                    <span className="sales-count-badge">
                      {`${filteredEvents.length} events`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="sales-selector-filters">
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  className="dashboard-input sales-selector-input"
                >
                  <option value="">All Types</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>

                <select
                  value={venueFilter}
                  onChange={(event) => setVenueFilter(event.target.value)}
                  className="dashboard-input sales-selector-input"
                >
                  <option value="">All Venues</option>
                  {venueOptions.map((venue) => (
                    <option key={venue} value={venue}>
                      {venue}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sales-results-list">
                {filteredEvents.length === 0 && (
                  <div className="empty-state">No events found for this filter.</div>
                )}

                {filteredEvents.map((event) => {
                  const isSelected = event.eventID === selectedEventId;
                  return (
                    <button
                      key={event.eventID}
                      type="button"
                      className={`sales-result-item${isSelected ? " active" : ""}`}
                      onClick={() => setSelectedEventId(event.eventID)}
                    >
                      <span className="sales-result-name">{event.name}</span>
                      <span className="sales-result-meta">
                        {event.date} | {formatTime12(event.time)}
                      </span>
                      <span className="sales-result-meta">
                        {event.venue || "-"} | {event.type || "-"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="sales-surface sales-panel sales-detail-panel">
              {!selectedEvent ? (
                <div className="empty-state">Select an event to view its summary.</div>
              ) : (
                <div className="sales-details sales-details-compact">
                  <div className="sales-details-titleblock">
                    <div className="sales-details-title">{selectedEvent.name}</div>
                  </div>

                  <div className="sales-detail-card">
                    <div className="sales-detail-grid">
                      <div className="sales-detail-field">
                        <div className="sales-detail-label">Date</div>
                        <div className="sales-detail-value">{selectedEvent.date}</div>
                      </div>

                      <div className="sales-detail-field">
                        <div className="sales-detail-label">Time</div>
                        <div className="sales-detail-value">
                          {formatTime12(selectedEvent.time)}
                        </div>
                      </div>

                      <div className="sales-detail-field">
                        <div className="sales-detail-label">Venue</div>
                        <div className="sales-detail-value">
                          {selectedEvent.venue || "-"}
                        </div>
                      </div>

                      <div className="sales-detail-field">
                        <div className="sales-detail-label">Category</div>
                        <div className="sales-detail-value">
                          {selectedEvent.type || "-"}
                        </div>
                      </div>
                    </div>

                    <div className="sales-metrics sales-metrics-compact">
                      <div className="sales-metric">
                        <div className="sales-metric-label">Sold</div>
                        <div className="sales-metric-value">{selectedEventSold}</div>
                      </div>

                      <div className="sales-metric">
                        <div className="sales-metric-label">Unsold</div>
                        <div className="sales-metric-value">{selectedEventUnsold}</div>
                      </div>

                      <div className="sales-metric">
                        <div className="sales-metric-label">Sell Through</div>
                        <div className="sales-metric-value">
                          {selectedEventSellThrough}%
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="sales-chart-grid sales-dashboard-row">
            <section className="sales-surface sales-chart-card">
              <div className="sales-chart-panel-top">
                <div>
                  <h4 className="ticket-title">Tickets Sold by Type</h4>
                  <p className="ticket-meta sales-selector-meta">
                    Current range totals by event type.
                  </p>
                </div>
                <div className="sales-chart-toolbar">
                  <EventSalesFilterPopover
                    id="chart-type-filter"
                    label="Types"
                    valueText={`${effectiveSelectedChartTypes.length}/${typeChartKeys.length || 0}`}
                    isOpen={openFilterId === "chart-type-filter"}
                    onToggle={toggleFilterPopover}
                    onClose={closeFilterPopover}
                  >
                    <div className="sales-scroll-list sales-scroll-list-compact">
                      {typeChartRows.length === 0 ? (
                        <div className="empty-state sales-chart-empty">
                          No types loaded yet.
                        </div>
                      ) : (
                        <>
                          <label className="sales-check-row">
                            <input
                              type="checkbox"
                              checked={allChartTypesSelected}
                              onChange={toggleAllChartTypes}
                            />
                            <span>All Types</span>
                          </label>

                          {typeChartRows.map((row) => (
                            <label key={row.key} className="sales-check-row">
                              <input
                                type="checkbox"
                                checked={effectiveSelectedChartTypes.includes(row.key)}
                                onChange={() => toggleChartType(row.key)}
                              />
                              <span>{row.key}</span>
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  </EventSalesFilterPopover>
                </div>
              </div>

              <div ref={typeChartContainerRef} className="sales-chart-canvas" />
            </section>

            <section className="sales-surface sales-chart-card">
              <div className="sales-chart-panel-top">
                <div>
                  <h4 className="ticket-title">Tickets Sold by Venue</h4>
                  <p className="ticket-meta sales-selector-meta">
                    Current range totals by venue.
                  </p>
                </div>
                <div className="sales-chart-toolbar">
                  <EventSalesFilterPopover
                    id="chart-venue-filter"
                    label="Venues"
                    valueText={`${effectiveSelectedChartVenues.length}/${venueChartKeys.length || 0}`}
                    isOpen={openFilterId === "chart-venue-filter"}
                    onToggle={toggleFilterPopover}
                    onClose={closeFilterPopover}
                  >
                    <div className="sales-scroll-list sales-scroll-list-compact">
                      {venueChartRows.length === 0 ? (
                        <div className="empty-state sales-chart-empty">
                          No venues loaded yet.
                        </div>
                      ) : (
                        <>
                          <label className="sales-check-row">
                            <input
                              type="checkbox"
                              checked={allChartVenuesSelected}
                              onChange={toggleAllChartVenues}
                            />
                            <span>All Venues</span>
                          </label>

                          {venueChartRows.map((row) => (
                            <label key={row.key} className="sales-check-row">
                              <input
                                type="checkbox"
                                checked={effectiveSelectedChartVenues.includes(row.key)}
                                onChange={() => toggleChartVenue(row.key)}
                              />
                              <span>{row.key}</span>
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  </EventSalesFilterPopover>
                </div>
              </div>

              <div ref={venueChartContainerRef} className="sales-chart-canvas" />
            </section>
          </div>
        </div>
      )}
    </>
  );
}

const EVENT_SALES_SECTION_STYLES = `
.dashboard-controls {display: flex; flex-wrap: wrap; gap: 1rem 1.25rem; align-items: flex-end;}
.dashboard-control-label {display: flex; flex-direction: column; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--neutral-grey); font-weight: 600; gap: 0.45rem;}
.dashboard-input {padding: 0.75rem 0.9rem; border-radius: var(--radius); border: 1px solid var(--mountain-grey); background: var(--white); font-size: 14px; font-family: inherit; color: var(--black); min-width: 180px; margin-bottom: 0; box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.04);}
.dashboard-input:focus {outline: none; border-color: var(--radford-red); box-shadow: 0 0 0 3px rgba(177, 18, 38, 0.14);}
.sales-global-filters {padding-top: 0;}
.sales-global-toolbar {gap: 0.75rem 1rem;}
.sales-global-toolbar .dashboard-control-label {gap: 0.28rem; font-size: 0.72rem;}
.sales-global-toolbar .dashboard-input {min-width: 170px; padding: 0.62rem 0.8rem;}
.sales-simple-error {color: var(--radford-red); font-weight: 600;}
.sales-top-surface {width: 100%; max-width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 0.8rem; padding: 0.85rem 0.9rem; border: 1px solid rgba(17, 24, 39, 0.06); border-radius: calc(var(--radius) - 2px); background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,250,251,0.96)); box-shadow: 0 1px 6px rgba(15, 23, 42, 0.04); box-sizing: border-box;}
.sales-top-header {display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap;}
.sales-top-title {margin-bottom: 0;}
.sales-top-toolbar {display: grid; gap: 0.75rem 0.85rem; align-items: end;}
.sales-top-toolbar-double {grid-template-columns: repeat(2, minmax(0, 1fr));}
.sales-top-date-label {display: flex; flex-direction: column; gap: 0.24rem;}
.sales-top-date-label-text {font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--neutral-grey);}
.sales-top-date-input {width: 100%; min-width: 0; padding: 0.58rem 0.78rem; border-radius: var(--radius); border: 1px solid var(--mountain-grey); background: rgba(255,255,255,0.96); font-size: 14px; font-family: inherit; color: var(--black); box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.04);}
.sales-top-date-input:focus {outline: none; border-color: var(--radford-red); box-shadow: 0 0 0 3px rgba(177, 18, 38, 0.14);}
.sales-top-range-note {color: var(--neutral-grey); font-size: 0.92rem;}
.sales-dashboard-layout {display: flex; flex-direction: column; gap: 0.85rem; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;}
.sales-dashboard-row {width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;}
.sales-panels,
.sales-chart-grid {display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.85rem; align-items: stretch; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;}
.sales-surface {width: 100%; max-width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 0.75rem; padding: 0.85rem 0.9rem; border: 1px solid rgba(17, 24, 39, 0.06); border-radius: calc(var(--radius) - 2px); background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,250,251,0.96)); box-shadow: 0 1px 6px rgba(15, 23, 42, 0.04); overflow: visible; box-sizing: border-box;}
.sales-panel-header {display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap;}
.sales-panel-title-row {display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap;}
.sales-surface-header .ticket-title {margin-bottom: 0;}
.sales-selector-meta {margin: 0;}
.sales-count-badge {display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; color: var(--neutral-grey); font-size: 0.82rem; font-weight: 500; white-space: nowrap;}
.sales-selector-panel {min-height: 0;}
.sales-detail-panel {justify-content: flex-start; min-height: 0; width: 100%; max-width: 100%; min-width: 0;}
.sales-selector-filters {display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.55rem;}
.sales-selector-input {width: 100%; min-width: 0;}
.sales-results-list {display: flex; flex-direction: column; gap: 0.45rem; max-height: 260px; overflow-y: auto; padding-right: 0.1rem;}
.sales-result-item {width: 100%; text-align: left; border: 1px solid rgba(17, 24, 39, 0.07); border-radius: calc(var(--radius) - 2px); background: rgba(255,255,255,0.96); padding: 0.72rem 0.8rem; cursor: pointer; transition: var(--transition);}
.sales-result-item:hover {border-color: rgba(13, 27, 42, 0.18); background: #fbfbfc; transform: translateY(-1px);}
.sales-result-item.active {border-color: rgba(177, 18, 38, 0.18); box-shadow: inset 2px 0 0 var(--radford-red); background: #fff9f9;}
.sales-result-name {display: block; font-size: 0.94rem; font-weight: 700; color: var(--black); line-height: 1.3; margin-bottom: 0.18rem;}
.sales-result-meta {display: block; font-size: 0.8rem; color: var(--neutral-grey); line-height: 1.35;}
.sales-details {display: flex; flex-direction: column; gap: 0.45rem; flex: 1 1 auto;}
.sales-details-compact {justify-content: flex-start; height: 100%; min-height: 0;}
.sales-details-titleblock {min-width: 0; padding-right: 0.15rem;}
.sales-details-title {font-size: 1.12rem; font-weight: 800; color: var(--black); line-height: 1.3; letter-spacing: 0;}
.sales-detail-card {display: flex; flex-direction: column; gap: 0.55rem; flex: 0 1 auto; justify-content: flex-start; min-height: 0; margin-top: 0; padding: 0.7rem 0.78rem 0.64rem; border: 1px solid rgba(17, 24, 39, 0.045); border-radius: calc(var(--radius) - 2px); background: rgba(15, 23, 42, 0.03);}
.sales-detail-grid {display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.52rem 0.72rem;}
.sales-detail-field {display: flex; flex-direction: column; gap: 0.18rem; min-width: 0;}
.sales-detail-label {font-size: 0.76rem; color: var(--neutral-grey); font-weight: 600; letter-spacing: 0.01em; text-transform: none;}
.sales-detail-value {font-size: 0.92rem; color: var(--black); font-weight: 600; line-height: 1.35; overflow-wrap: anywhere;}
.sales-metrics {display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.45rem;}
.sales-metrics-compact {margin-top: 0; padding-top: 0.45rem; border-top: 1px solid rgba(17, 24, 39, 0.055);}
.sales-metric {border: 1px solid rgba(17, 24, 39, 0.045); border-radius: 8px; padding: 0.58rem 0.62rem; background: rgba(255,255,255,0.92);}
.sales-metric-label {font-size: 0.74rem; color: var(--neutral-grey); text-transform: none; letter-spacing: 0; font-weight: 600;}
.sales-metric-value {margin-top: 0.12rem; font-size: 1.08rem; font-weight: 800; color: var(--radford-red);}
.sales-chart-card {min-width: 0; max-width: 100%; width: 100%; height: 100%; position: relative; box-sizing: border-box;}
.sales-chart-panel-top {display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem; flex-wrap: wrap; min-height: 58px; padding-bottom: 0.1rem; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;}
.sales-chart-panel-top > div:first-child {flex: 1 1 auto; min-width: 0;}
.sales-chart-panel-top .ticket-title {font-size: 1rem; margin-bottom: 0.1rem;}
.sales-chart-panel-top .ticket-meta {font-size: 0.8rem; line-height: 1.35;}
.sales-chart-toolbar {display: flex; align-items: center; justify-content: flex-end; gap: 0.35rem; flex-wrap: wrap; min-height: 34px; flex: 0 0 auto; max-width: 100%; min-width: 0;}
.sales-chart-canvas {width: 100%; max-width: 100%; height: 415px; flex: 1 1 auto; min-height: 415px; min-width: 0; box-sizing: border-box;}
.sales-filter-menu {position: relative; min-width: 0;}
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
.sales-chart-empty,
.event-filter-empty {padding: 0.5rem 0; color: var(--neutral-grey); font-size: 0.9rem;}

@media (max-width: 768px) {
  .sales-chart-grid,
  .sales-panels,
  .sales-selector-filters,
  .sales-metrics,
  .sales-detail-grid {grid-template-columns: 1fr;}
  .sales-chart-panel-top {justify-content: flex-start;}
  .sales-chart-toolbar {width: 100%;}
  .sales-filter-menu {width: 100%;}
  .sales-filter-popover {left: 0; right: auto; width: min(100%, 320px);}
  .sales-top-toolbar-double {grid-template-columns: 1fr;}
  .sales-chart-canvas {height: 360px;}
}
`;
