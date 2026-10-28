/**
 * Displays revenue analytics with event-level revenue metrics.
 */
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import Plotly from "plotly.js-dist-min";

function shortChartLabel(label) {
  const text = String(label || "");
  return text.length > 18 ? `${text.slice(0, 15)}...` : text;
}

function RevenueFilterPopover({
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
          className={`sales-filter-summary-chevron${isOpen ? " is-open" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {isOpen && <div className="sales-filter-popover">{children}</div>}
    </div>
  );
}

const REVENUE_CHART_STYLES = `
.revenue-chart-card {
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
.revenue-chart-panel-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem;
  flex-wrap: wrap;
  min-height: 58px;
  padding-bottom: 0.1rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.revenue-chart-panel-top > div:first-child {
  flex: 1 1 auto;
  min-width: 0;
}
.revenue-chart-panel-top .ticket-title {
  font-size: 1rem;
  margin-bottom: 0.1rem;
}
.revenue-chart-panel-top .ticket-meta {
  font-size: 0.8rem;
  line-height: 1.35;
  margin: 0;
}
.revenue-chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  flex-wrap: wrap;
  min-height: 34px;
  flex: 0 0 auto;
}
.revenue-chart-select {
  min-width: 280px;
  max-width: 360px;
  width: 100%;
  min-height: 42px;
  padding: 0.58rem 0.78rem;
  border-radius: calc(var(--radius) - 2px);
  border: 1px solid rgba(17, 24, 39, 0.08);
  background: rgba(255,255,255,0.96);
  font-size: 0.82rem;
  color: var(--black);
  box-shadow: inset 0 1px 2px rgba(17, 24, 39, 0.02);
  box-sizing: border-box;
}
.revenue-chart-select:focus {
  outline: none;
  border-color: rgba(13, 27, 42, 0.14);
  box-shadow: 0 0 0 2px rgba(13, 27, 42, 0.04);
}
.revenue-chart-canvas {
  width: 100%;
  height: 415px;
  min-height: 415px;
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
}
.revenue-chart-canvas-wide {
  width: 100%;
  height: 520px;
  min-height: 520px;
  max-width: 900px;
  margin: 0 auto;
}
.revenue-detail-rows {
  margin-top: 8px;
  max-width: 900px;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
}
.revenue-detail-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-top: 1px dashed #e2e2e2;
}
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
.sales-scroll-list {max-height: 150px; overflow-y: auto; overflow-x: hidden; padding-right: 0.15rem;}
.sales-check-row {display: grid; grid-template-columns: 18px minmax(0, 1fr); column-gap: 0.65rem; align-items: start; padding: 0.32rem 0; color: var(--black); cursor: pointer; line-height: 1.3;}
.sales-check-row input[type="checkbox"] {width: 16px; height: 16px; margin: 0.1rem 0 0; accent-color: var(--radford-red);}
.sales-check-row span {min-width: 0; overflow-wrap: anywhere; font-size: 0.84rem;}
.revenue-chart-empty {padding: 0.5rem 0; color: var(--neutral-grey); font-size: 0.9rem;}
@media (max-width: 768px) {
  .revenue-chart-panel-top {justify-content: flex-start;}
  .revenue-chart-toolbar {width: 100%;}
  .sales-filter-menu {width: 100%;}
  .sales-filter-popover {left: 0; right: auto; width: min(100%, 320px);}
  .revenue-chart-select {max-width: none;}
  .revenue-chart-canvas {height: 360px; min-height: 360px;}
  .revenue-chart-canvas-wide {height: 420px; min-height: 420px;}
}
`;

/**
 * Renders the revenue analytics dashboard.
 *
 * This component is designed to be mounted inside AnalyticsDashboard
 * as tab content, similar to AttendanceDashboard.
 *
 * @returns {JSX.Element} The revenue dashboard view.
 */
export default function RevenueDashboard() {
  const TEAM2_GET_EVENTS_BY_DATE_URL = import.meta.env.VITE_TEAM2_GET_EVENTS_BY_DATE;

  const TEAM3_GET_SALES_BY_DATE_URL = import.meta.env.VITE_TEAM3_GET_SALES_BY_DATE;

  const TEAM3_GET_ATTENDANCE_BY_DATE_URL =
    import.meta.env.VITE_TEAM3_GET_ATTENDANCE_BY_DATE;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedStart, setAppliedStart] = useState("");
  const [appliedEnd, setAppliedEnd] = useState("");

  const [sortColumn, setSortColumn] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc");

  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedVenues, setSelectedVenues] = useState([]);
  const [openFilterId, setOpenFilterId] = useState(null);

  const eventChartRef = useRef(null);
  const typeChartRef = useRef(null);
  const venueChartRef = useRef(null);

  const chartBlue = "#0d1b2a";
  const chartRed = "#c2011b";

  function normalizeTier(tier) {
    const t = String(tier || "").trim().toLowerCase();
    if (t === "vip") return "vip";
    if (t === "budget") return "budget";
    return "standard";
  }

  function getTierPrice(event, tier) {
    const normalizedTier = normalizeTier(tier);

    const vipPrice = Number(event?.vipPrice) || 0;
    const standardPrice = Number(event?.standardPrice) || 0;
    const budgetPrice = Number(event?.budgetPrice) || 0;
    const generalPrice = Number(event?.price) || 0;

    if (normalizedTier === "vip") {
      return vipPrice || standardPrice || generalPrice || budgetPrice || 0;
    }

    if (normalizedTier === "budget") {
      return budgetPrice || standardPrice || generalPrice || vipPrice || 0;
    }

    return standardPrice || generalPrice || budgetPrice || vipPrice || 0;
  }

  function getBaseTicketPrice(type) {
    const t = (type || "").toLowerCase();
    if (t.includes("concert")) return 32;
    if (t.includes("basketball")) return 18;
    if (t.includes("athletic")) return 16;
    if (t.includes("theatre")) return 22;
    if (t.includes("comedy")) return 20;
    if (t.includes("lecture")) return 10;
    if (t.includes("music")) return 20;
    if (t.includes("sports")) return 18;
    if (t.includes("workshop")) return 15;
    if (t.includes("career")) return 10;
    if (t.includes("food")) return 12;
    return 15;
  }

  function getAverageEventTicketPrice(event) {
    const prices = [
      Number(event?.standardPrice) || 0,
      Number(event?.budgetPrice) || 0,
      Number(event?.vipPrice) || 0,
      Number(event?.price) || 0,
    ].filter((p) => p > 0);

    if (prices.length > 0) {
      return prices.reduce((sum, p) => sum + p, 0) / prices.length;
    }

    return getBaseTicketPrice(event?.type);
  }

  async function fetchAllEvents(dateFrom, dateTo) {
    const allItems = [];
    let nextToken = "";

    do {
      const url = new URL(TEAM2_GET_EVENTS_BY_DATE_URL);
      url.searchParams.set("startDate", dateFrom);
      url.searchParams.set("endDate", dateTo);
      url.searchParams.set("type", "both");
      url.searchParams.set("limit", "100");

      if (nextToken) {
        url.searchParams.set("nextToken", nextToken);
      }

      const resp = await fetch(url.toString());
      if (!resp.ok) {
        throw new Error(`Failed to fetch events: ${resp.status} ${resp.statusText}`);
      }

      const json = await resp.json();
      const items = Array.isArray(json?.items) ? json.items : [];
      allItems.push(...items);
      nextToken = json?.nextToken || "";
    } while (nextToken);

    return allItems;
  }

  async function fetchAllSales(dateFrom, dateTo) {
    const url = new URL(TEAM3_GET_SALES_BY_DATE_URL);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new Error(`Failed to fetch sales: ${resp.status} ${resp.statusText}`);
    }

    const json = await resp.json();
    return Array.isArray(json?.sales) ? json.sales : [];
  }

  async function fetchAllAttendance(dateFrom, dateTo) {
    const url = new URL(TEAM3_GET_ATTENDANCE_BY_DATE_URL);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new Error(`Failed to fetch attendance: ${resp.status} ${resp.statusText}`);
    }

    const json = await resp.json();
    return Array.isArray(json?.sales) ? json.sales : [];
  }

  const load = useCallback(async () => {
    if (
      !TEAM2_GET_EVENTS_BY_DATE_URL ||
      !TEAM3_GET_SALES_BY_DATE_URL ||
      !TEAM3_GET_ATTENDANCE_BY_DATE_URL
    ) {
      setErr("Missing Team 2 / Team 3 environment variables.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const today = new Date().toISOString().slice(0, 10);
      const queryStart = startDate || "2026-01-01";
      const queryEnd = endDate || "2026-12-31";

      const WIDE_START = "2025-01-01";
      const WIDE_END = "2027-12-31";

      const [rawEvents, allSales, allAttendance] = await Promise.all([
        fetchAllEvents(queryStart, queryEnd),
        fetchAllSales(WIDE_START, WIDE_END),
        fetchAllAttendance(WIDE_START, WIDE_END),
      ]);

      const normalizedEvents = rawEvents
        .map((item) => ({
          eventID: item?.event_id || "",
          name: item?.event_name || "Untitled Event",
          date: String(item?.date_time || "").slice(0, 10),
          type: item?.categories?.[0] || "Other",
          venue: item?.venue_name || item?.location || "Unknown",
          ticketsIssued: Number(item?.seat_count) || 0,
          price: Number(item?.price) || 0,
          standardPrice: Number(item?.standard_price) || 0,
          budgetPrice: Number(item?.budget_price) || 0,
          vipPrice: Number(item?.vip_price) || 0,
          status: item?.status || "ACTIVE",
        }))
        .filter((event) => event.eventID && event.date && event.status !== "CANCELLED");

      const salesByEvent = {};
      for (const sale of allSales) {
        const eventId = sale?.eventId;
        if (!eventId) continue;
        if (!salesByEvent[eventId]) salesByEvent[eventId] = [];
        salesByEvent[eventId].push(sale);
      }

      const usedTicketIdsByEvent = {};
      for (const used of allAttendance) {
        const eventId = used?.eventId;
        const ticketId = used?.ticketId;
        if (!eventId || !ticketId) continue;
        if (!usedTicketIdsByEvent[eventId]) usedTicketIdsByEvent[eventId] = new Set();
        usedTicketIdsByEvent[eventId].add(ticketId);
      }

      const byEvent = normalizedEvents
        .map((event) => {
          const eventSales = salesByEvent[event.eventID] || [];
          const usedTicketIds = usedTicketIdsByEvent[event.eventID] || new Set();

          let soldTickets = 0;
          let usedTickets = 0;
          let realizedRevenue = 0;
          let attendedRevenue = 0;
          let noShowRevenue = 0;

          for (const ticket of eventSales) {
            const ticketId = ticket?.ticketId || "";
            const ticketStatus = String(ticket?.status || "").toUpperCase();

            if (ticketStatus !== "SOLD" && ticketStatus !== "USED") continue;

            const ticketUsed =
              ticketStatus === "USED" ||
              Boolean(ticket?.usedAt) ||
              usedTicketIds.has(ticketId);

            const tierPrice = getTierPrice(event, ticket?.tier);
            const fallbackPrice = getAverageEventTicketPrice(event);
            const finalPrice = tierPrice > 0 ? tierPrice : fallbackPrice;

            soldTickets += 1;
            realizedRevenue += finalPrice;

            if (ticketUsed) {
              usedTickets += 1;
              attendedRevenue += finalPrice;
            } else {
              noShowRevenue += finalPrice;
            }
          }

          const avgTicketPrice =
            soldTickets > 0
              ? realizedRevenue / soldTickets
              : getAverageEventTicketPrice(event);

          return {
            ...event,
            soldTickets,
            usedTickets,
            avgTicketPrice,
            realizedRevenue,
            attendedRevenue,
            noShowRevenue,
          };
        })
        .filter((event) => event.realizedRevenue > 0);

      setData({ byEvent });

      const dates = byEvent.map((event) => event.date).filter(Boolean).sort();
      const minDate = dates[0] || today;
      const maxDate = dates[dates.length - 1] || today;

      setStartDate((prev) => prev || minDate);
      setEndDate((prev) => prev || maxDate);
      setAppliedStart((prev) => prev || minDate);
      setAppliedEnd((prev) => prev || maxDate);
    } catch (e) {
      setErr(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    TEAM2_GET_EVENTS_BY_DATE_URL,
    TEAM3_GET_SALES_BY_DATE_URL,
    TEAM3_GET_ATTENDANCE_BY_DATE_URL,
    startDate,
    endDate,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!startDate) return;
    const safeEnd = endDate && endDate >= startDate ? endDate : startDate;
    setAppliedStart(startDate);
    setAppliedEnd(safeEnd);
  }, [startDate, endDate]);

  useEffect(() => {
    const observers = [];
    const refs = [eventChartRef, typeChartRef, venueChartRef];

    refs.forEach((ref) => {
      if (!ref.current) return;
      const observer = new ResizeObserver(() => {
        Plotly.Plots.resize(ref.current);
      });
      observer.observe(ref.current);
      observers.push(observer);
    });

    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

  function inRange(date, start, end) {
    if (!date) return false;
    if (!start && !end) return true;
    const s = start || date;
    const e = end || s;
    return date >= s && date <= e;
  }

  function money(n) {
    if (n == null) return "—";
    return `$${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function handleHeaderSort(column) {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  }

  function getSortIndicator(column) {
    if (sortColumn !== column) return "↕";
    return sortDirection === "desc" ? "▲" : "▼";
  }

  function handleStartDateChange(value) {
    setStartDate(value);

    if (!value) return;

    if (endDate && value > endDate) {
      setEndDate(value);
    }
  }

  function handleEndDateChange(value) {
    setEndDate(value);

    if (!value) return;

    if (startDate && value < startDate) {
      setStartDate(value);
    }
  }

  const allEvents = useMemo(() => {
    return Array.isArray(data?.byEvent) ? data.byEvent : [];
  }, [data]);

  const availableDates = useMemo(() => {
    const dates = allEvents.map((event) => event?.date).filter(Boolean).sort();
    return {
      min: dates[0] || "",
      max: dates[dates.length - 1] || "",
    };
  }, [allEvents]);

  const filteredEvents = useMemo(() => {
    const s = appliedStart;
    const e = appliedEnd || appliedStart;

    const rows = allEvents.filter((event) => inRange(event?.date, s, e)).slice();

    rows.sort((a, b) => {
      let comparison = 0;

      if (sortColumn === "date") {
        comparison = (a?.date || "").localeCompare(b?.date || "");
      } else if (sortColumn === "event") {
        comparison = (a?.name || "").localeCompare(b?.name || "");
      } else if (sortColumn === "type") {
        comparison = (a?.type || "").localeCompare(b?.type || "");
      } else if (sortColumn === "location") {
        comparison = (a?.venue || "").localeCompare(b?.venue || "");
      } else if (sortColumn === "avgTicketPrice") {
        comparison =
          (Number(a?.avgTicketPrice) || 0) - (Number(b?.avgTicketPrice) || 0);
      } else if (sortColumn === "revenue") {
        comparison =
          (Number(a?.realizedRevenue) || 0) - (Number(b?.realizedRevenue) || 0);
      } else if (sortColumn === "attendedRevenue") {
        comparison =
          (Number(a?.attendedRevenue) || 0) - (Number(b?.attendedRevenue) || 0);
      } else if (sortColumn === "noShowRevenue") {
        comparison =
          (Number(a?.noShowRevenue) || 0) - (Number(b?.noShowRevenue) || 0);
      }

      if (comparison === 0) {
        comparison = (a?.name || "").localeCompare(b?.name || "");
      }

      return sortDirection === "desc" ? -comparison : comparison;
    });

    return rows;
  }, [allEvents, appliedStart, appliedEnd, sortColumn, sortDirection]);

  useEffect(() => {
    if (filteredEvents.length === 0) {
      setSelectedEventId("");
      return;
    }

    const exists = filteredEvents.some((event) => event.eventID === selectedEventId);
    if (!exists) {
      setSelectedEventId(filteredEvents[0].eventID);
    }
  }, [filteredEvents, selectedEventId]);

  const selectedEvent = useMemo(() => {
    return filteredEvents.find((event) => event.eventID === selectedEventId) || null;
  }, [filteredEvents, selectedEventId]);

  const overallFiltered = useMemo(() => {
    const realizedRevenue = filteredEvents.reduce(
      (acc, event) => acc + (Number(event.realizedRevenue) || 0),
      0
    );
    const attendedRevenue = filteredEvents.reduce(
      (acc, event) => acc + (Number(event.attendedRevenue) || 0),
      0
    );
    const noShowRevenue = filteredEvents.reduce(
      (acc, event) => acc + (Number(event.noShowRevenue) || 0),
      0
    );
    const avgRevenuePerEvent =
      filteredEvents.length > 0 ? realizedRevenue / filteredEvents.length : 0;
    const avgTicketPrice =
      filteredEvents.length > 0
        ? filteredEvents.reduce(
            (acc, event) => acc + (Number(event.avgTicketPrice) || 0),
            0
          ) / filteredEvents.length
        : 0;

    return {
      realizedRevenue,
      attendedRevenue,
      noShowRevenue,
      avgRevenuePerEvent,
      avgTicketPrice,
    };
  }, [filteredEvents]);

  const byTypeFiltered = useMemo(() => {
    const map = {};

    for (const event of filteredEvents) {
      const key = event?.type || "Unknown";
      if (!map[key]) {
        map[key] = {
          realizedRevenue: 0,
        };
      }

      map[key].realizedRevenue += Number(event.realizedRevenue) || 0;
    }

    return map;
  }, [filteredEvents]);

  const byVenueFiltered = useMemo(() => {
    const map = {};

    for (const event of filteredEvents) {
      const key = event?.venue || "Unknown";
      if (!map[key]) {
        map[key] = {
          realizedRevenue: 0,
        };
      }

      map[key].realizedRevenue += Number(event.realizedRevenue) || 0;
    }

    return map;
  }, [filteredEvents]);

  const typeKeys = useMemo(() => Object.keys(byTypeFiltered).sort(), [byTypeFiltered]);
  const venueKeys = useMemo(() => Object.keys(byVenueFiltered).sort(), [byVenueFiltered]);

  useEffect(() => {
    setSelectedTypes((prev) =>
      prev.length ? prev.filter((type) => typeKeys.includes(type)) : typeKeys
    );
    setSelectedVenues((prev) =>
      prev.length ? prev.filter((venue) => venueKeys.includes(venue)) : venueKeys
    );
  }, [typeKeys, venueKeys]);

  const allTypesSelected =
    typeKeys.length > 0 && selectedTypes.length === typeKeys.length;
  const allVenuesSelected =
    venueKeys.length > 0 && selectedVenues.length === venueKeys.length;

  function toggleSelectAllTypes() {
    setSelectedTypes(allTypesSelected ? [] : typeKeys);
  }

  function toggleSelectAllVenues() {
    setSelectedVenues(allVenuesSelected ? [] : venueKeys);
  }

  function toggleType(type) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
    );
  }

  function toggleVenue(venue) {
    setSelectedVenues((prev) =>
      prev.includes(venue)
        ? prev.filter((item) => item !== venue)
        : [...prev, venue]
    );
  }

  function toggleFilterPopover(id) {
    setOpenFilterId((current) => (current === id ? null : id));
  }

  function closeFilterPopover() {
    setOpenFilterId(null);
  }

  const filteredTypesRows = useMemo(() => {
    const selected = new Set(selectedTypes);
    return typeKeys
      .filter((type) => selected.has(type))
      .map((type) => ({ key: type, ...byTypeFiltered[type] }));
  }, [typeKeys, selectedTypes, byTypeFiltered]);

  const filteredVenuesRows = useMemo(() => {
    const selected = new Set(selectedVenues);
    return venueKeys
      .filter((venue) => selected.has(venue))
      .map((venue) => ({ key: venue, ...byVenueFiltered[venue] }));
  }, [venueKeys, selectedVenues, byVenueFiltered]);

  function drawEmptyEventBreakdown() {
    if (!eventChartRef.current) return;

    const layout = {
      annotations: [
        {
          text: "No data",
          showarrow: false,
          font: { size: 16, color: "#666" },
          x: 0.5,
          y: 0.5,
        },
      ],
      showlegend: false,
      xaxis: { visible: false },
      yaxis: { visible: false },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 24, r: 30, l: 30, b: 40 },
    };

    Plotly.react(eventChartRef.current, [], layout, {
      displayModeBar: false,
      responsive: true,
    });
  }

  function drawEventBreakdown(event) {
    if (!eventChartRef.current) return;

    const attendedRevenue = event?.attendedRevenue ?? 0;
    const noShowRevenue = event?.noShowRevenue ?? 0;
    const realizedRevenue = event?.realizedRevenue ?? 0;

    const plotData = [
      {
        type: "pie",
        labels: ["Attended Revenue", "No-Show Revenue"],
        values: [attendedRevenue, noShowRevenue],
        hole: 0.55,
        textinfo: "label+percent",
        textposition: "inside",
        insidetextorientation: "radial",
        marker: { colors: [chartBlue, chartRed] },
      },
    ];

    const layout = {
      annotations: [
        {
          text: `<b>${money(realizedRevenue)}</b><br>Revenue`,
          showarrow: false,
          font: { size: 14, color: "#111" },
          x: 0.5,
          y: 0.5,
        },
      ],
      showlegend: true,
      legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.08 },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 24, r: 30, l: 30, b: 80 },
    };

    Plotly.react(eventChartRef.current, plotData, layout, {
      displayModeBar: false,
      responsive: true,
    });
  }

  function drawTypeChart(rows) {
    if (!typeChartRef.current) return;

    const x = rows.map((row) => shortChartLabel(row.key));
    const y = rows.map((row) => Math.round(row.realizedRevenue || 0));
    const plotData = [
      {
        x,
        y,
        customdata: rows.map((row) => row.key),
        type: "bar",
        marker: { color: chartBlue },
        hovertemplate: "%{customdata}: $%{y}<extra></extra>",
      },
    ];

    const layout = {
      yaxis: {
        title: "Revenue ($)",
        rangemode: "tozero",
        automargin: true,
      },
      xaxis: {
        automargin: true,
        tickangle: -35,
      },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 24, r: 20, l: 52, b: 135 },
    };

    Plotly.react(typeChartRef.current, plotData, layout, {
      displayModeBar: false,
      responsive: true,
    });
  }

  function drawVenueChart(rows) {
    if (!venueChartRef.current) return;

    const x = rows.map((row) => shortChartLabel(row.key));
    const y = rows.map((row) => Math.round(row.realizedRevenue || 0));
    const plotData = [
      {
        x,
        y,
        customdata: rows.map((row) => row.key),
        type: "bar",
        marker: { color: chartBlue },
        hovertemplate: "%{customdata}: $%{y}<extra></extra>",
      },
    ];

    const layout = {
      yaxis: {
        title: "Revenue ($)",
        rangemode: "tozero",
        automargin: true,
      },
      xaxis: {
        automargin: true,
        tickangle: -35,
      },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 24, r: 20, l: 52, b: 135 },
    };

    Plotly.react(venueChartRef.current, plotData, layout, {
      displayModeBar: false,
      responsive: true,
    });
  }

  useEffect(() => {
    if (selectedEvent) {
      drawEventBreakdown(selectedEvent);
    } else {
      drawEmptyEventBreakdown();
    }
  }, [selectedEvent]);

  useEffect(() => {
    if (data) {
      drawTypeChart(filteredTypesRows);
    }
  }, [data, filteredTypesRows]);

  useEffect(() => {
    if (data) {
      drawVenueChart(filteredVenuesRows);
    }
  }, [data, filteredVenuesRows]);

  const prettyLabelStyle = {
    fontSize: "0.95rem",
    fontWeight: 700,
    letterSpacing: "1.2px",
    textTransform: "uppercase",
    color: "#5d6f86",
    marginBottom: 10,
    display: "block",
  };

  const cardStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };

  const statsGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  };

  const filterGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
    alignItems: "end",
  };

  const tableHeaderStyle = (column) => {
    const isActive = sortColumn === column;

    return {
      position: "sticky",
      top: 0,
      zIndex: 5,
      background: isActive ? "#cfd6df" : "#d9dee5",
      color: "#202938",
      fontWeight: 800,
      fontSize: "0.98rem",
      textAlign: "left",
      padding: "20px 20px",
      borderBottom: "1px solid #c8d0d9",
      cursor: "pointer",
      userSelect: "none",
      whiteSpace: "nowrap",
    };
  };

  const tableCellStyle = {
    padding: "22px 20px",
    borderBottom: "1px solid #d9e0e7",
    background: "#f9fafb",
    verticalAlign: "middle",
    fontSize: "0.98rem",
  };

  const emptyTableCellStyle = {
    padding: "24px 20px",
    textAlign: "center",
    color: "#5c6673",
    background: "#f9fafb",
  };

  return (
    <>
      <style>{REVENUE_CHART_STYLES}</style>
      {loading && (
        <div className="loading-state">⏳ Loading revenue analytics...</div>
      )}

      {!loading && (
        <div className="analytics-overview-grid">
          <div className="analytics-overview-card" style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <h3 style={{ margin: 0 }}>Revenue Analytics</h3>
              <button
                type="button"
                onClick={load}
                className="btn-accent"
                title="Reload analytics data"
              >
                Refresh
              </button>
            </div>

            {err && (
              <div style={{ color: "var(--radford-red)", fontWeight: 700 }}>
                Error: {err}
              </div>
            )}

            <div style={filterGridStyle}>
              <label style={{ display: "flex", flexDirection: "column" }}>
                <span style={prettyLabelStyle}>Start Date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column" }}>
                <span style={prettyLabelStyle}>End Date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                />
              </label>
            </div>

            {!err && (
              <div>
                Showing events from <b>{appliedStart || "—"}</b> to{" "}
                <b>{appliedEnd || appliedStart || "—"}</b>. Events in range:{" "}
                <b>{filteredEvents.length}</b>
              </div>
            )}
          </div>

          <div className="analytics-overview-card" style={cardStyle}>
            <h3 style={{ margin: 0 }}>Filtered Summary</h3>

            <div style={statsGridStyle}>
              <div className="stat-card">
                <div className="stat-label">Revenue</div>
                <div className="stat-value">{money(overallFiltered.realizedRevenue)}</div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Avg Ticket Price</div>
                <div className="stat-value">{money(overallFiltered.avgTicketPrice)}</div>
              </div>

              <div className="stat-card">
                <div className="stat-label">No-Show Revenue</div>
                <div className="stat-value">{money(overallFiltered.noShowRevenue)}</div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Avg Revenue / Event</div>
                <div className="stat-value">{money(overallFiltered.avgRevenuePerEvent)}</div>
              </div>
            </div>
          </div>

          <section
            className="revenue-chart-card"
            style={{ gridColumn: "1 / -1" }}
          >
            <div className="revenue-chart-panel-top">
              <div>
                <h4 className="ticket-title">Event Revenue</h4>
                <p className="ticket-meta">
                  Attended and no-show revenue mix for the selected event.
                </p>
              </div>
              <div className="revenue-chart-toolbar">
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  disabled={filteredEvents.length === 0}
                  className="revenue-chart-select"
                >
                  {filteredEvents.length === 0 ? (
                    <option value="">No events in this date range</option>
                  ) : (
                    filteredEvents.map((event) => (
                      <option key={event.eventID} value={event.eventID}>
                        {event.date} — {event.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div
              ref={eventChartRef}
              className="revenue-chart-canvas revenue-chart-canvas-wide"
            />

            <div className="revenue-detail-rows">
              {selectedEvent ? (
                <>
                  <div className="revenue-detail-row">
                    <span>Selected Event Revenue</span>
                    <b>{money(selectedEvent.realizedRevenue)}</b>
                  </div>

                  <div className="revenue-detail-row">
                    <span>Average Ticket Price</span>
                    <b>{money(selectedEvent.avgTicketPrice)}</b>
                  </div>

                  <div className="revenue-detail-row">
                    <span>Attended Revenue</span>
                    <b>{money(selectedEvent.attendedRevenue)}</b>
                  </div>

                  <div className="revenue-detail-row">
                    <span>No-Show Revenue</span>
                    <b>{money(selectedEvent.noShowRevenue)}</b>
                  </div>
                </>
              ) : (
                <div style={{ opacity: 0.8 }}>
                  No valid event data in the selected date range.
                </div>
              )}
            </div>
          </section>

          <section className="revenue-chart-card">
            <div className="revenue-chart-panel-top">
              <div>
                <h4 className="ticket-title">Revenue by Type</h4>
                <p className="ticket-meta">
                  Current range revenue totals by event type.
                </p>
              </div>
              <div className="revenue-chart-toolbar">
                <RevenueFilterPopover
                  id="revenue-type-filter"
                  label="Types"
                  valueText={`${selectedTypes.length}/${typeKeys.length || 0}`}
                  isOpen={openFilterId === "revenue-type-filter"}
                  onToggle={toggleFilterPopover}
                  onClose={closeFilterPopover}
                >
                  <div className="sales-scroll-list">
                    {typeKeys.length === 0 ? (
                      <div className="revenue-chart-empty">No Types Loaded Yet.</div>
                    ) : (
                      <>
                        <label className="sales-check-row">
                          <input
                            type="checkbox"
                            checked={allTypesSelected}
                            onChange={toggleSelectAllTypes}
                          />
                          <span>All Types</span>
                        </label>

                        {typeKeys.map((type) => (
                          <label key={type} className="sales-check-row">
                            <input
                              type="checkbox"
                              checked={selectedTypes.includes(type)}
                              onChange={() => toggleType(type)}
                            />
                            <span>{type}</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                </RevenueFilterPopover>
              </div>
            </div>

            <div ref={typeChartRef} className="revenue-chart-canvas" />
          </section>

          <section className="revenue-chart-card">
            <div className="revenue-chart-panel-top">
              <div>
                <h4 className="ticket-title">Revenue by Location</h4>
                <p className="ticket-meta">
                  Current range revenue totals by location.
                </p>
              </div>
              <div className="revenue-chart-toolbar">
                <RevenueFilterPopover
                  id="revenue-location-filter"
                  label="Locations"
                  valueText={`${selectedVenues.length}/${venueKeys.length || 0}`}
                  isOpen={openFilterId === "revenue-location-filter"}
                  onToggle={toggleFilterPopover}
                  onClose={closeFilterPopover}
                >
                  <div className="sales-scroll-list">
                    {venueKeys.length === 0 ? (
                      <div className="revenue-chart-empty">
                        No Locations Loaded Yet.
                      </div>
                    ) : (
                      <>
                        <label className="sales-check-row">
                          <input
                            type="checkbox"
                            checked={allVenuesSelected}
                            onChange={toggleSelectAllVenues}
                          />
                          <span>All Locations</span>
                        </label>

                        {venueKeys.map((venue) => (
                          <label key={venue} className="sales-check-row">
                            <input
                              type="checkbox"
                              checked={selectedVenues.includes(venue)}
                              onChange={() => toggleVenue(venue)}
                            />
                            <span>{venue}</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                </RevenueFilterPopover>
              </div>
            </div>

            <div ref={venueChartRef} className="revenue-chart-canvas" />
          </section>

          <div
            className="analytics-overview-card"
            style={{
              ...cardStyle,
              overflow: "hidden",
              gridColumn: "1 / -1",
              padding: 28,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 800,
                color: "#0d1b2a",
              }}
            >
              Event Revenue Table (Filtered Range)
            </h3>

            <div
              style={{
                opacity: 0.8,
                fontSize: "0.95rem",
                marginTop: 4,
                marginBottom: 6,
                color: "#3f4752",
              }}
            >
              Revenue values below use Team 2 pricing and Team 3 sold/used ticket data.
            </div>

            <div
              style={{
                maxHeight: 540,
                overflowX: "auto",
                overflowY: "auto",
                border: "1px solid #d4dbe3",
                borderRadius: 22,
                background: "#f9fafb",
              }}
            >
              <table
                style={{
                  width: "100%",
                  minWidth: 1200,
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  fontSize: "0.98rem",
                  color: "#122033",
                }}
              >
                <thead>
                  <tr>
                    <th
                      onClick={() => handleHeaderSort("date")}
                      style={tableHeaderStyle("date")}
                      title="Sort by date"
                    >
                      Date {getSortIndicator("date")}
                    </th>
                    <th
                      onClick={() => handleHeaderSort("event")}
                      style={tableHeaderStyle("event")}
                      title="Sort by event"
                    >
                      Event {getSortIndicator("event")}
                    </th>
                    <th
                      onClick={() => handleHeaderSort("type")}
                      style={tableHeaderStyle("type")}
                      title="Sort by type"
                    >
                      Type {getSortIndicator("type")}
                    </th>
                    <th
                      onClick={() => handleHeaderSort("location")}
                      style={tableHeaderStyle("location")}
                      title="Sort by location"
                    >
                      Location {getSortIndicator("location")}
                    </th>
                    <th
                      onClick={() => handleHeaderSort("avgTicketPrice")}
                      style={tableHeaderStyle("avgTicketPrice")}
                      title="Sort by average ticket price"
                    >
                      Avg Ticket Price {getSortIndicator("avgTicketPrice")}
                    </th>
                    <th
                      onClick={() => handleHeaderSort("revenue")}
                      style={tableHeaderStyle("revenue")}
                      title="Sort by revenue"
                    >
                      Revenue {getSortIndicator("revenue")}
                    </th>
                    <th
                      onClick={() => handleHeaderSort("attendedRevenue")}
                      style={tableHeaderStyle("attendedRevenue")}
                      title="Sort by attended revenue"
                    >
                      Attended Revenue {getSortIndicator("attendedRevenue")}
                    </th>
                    <th
                      onClick={() => handleHeaderSort("noShowRevenue")}
                      style={tableHeaderStyle("noShowRevenue")}
                      title="Sort by no-show revenue"
                    >
                      No-Show Revenue {getSortIndicator("noShowRevenue")}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.eventID}>
                      <td style={tableCellStyle}>{event.date}</td>
                      <td style={tableCellStyle}>{event.name}</td>
                      <td style={tableCellStyle}>{event.type}</td>
                      <td style={tableCellStyle}>{event.venue}</td>
                      <td style={tableCellStyle}>{money(event.avgTicketPrice)}</td>
                      <td style={tableCellStyle}>{money(event.realizedRevenue)}</td>
                      <td style={tableCellStyle}>{money(event.attendedRevenue)}</td>
                      <td style={tableCellStyle}>{money(event.noShowRevenue)}</td>
                    </tr>
                  ))}

                  {filteredEvents.length === 0 && (
                    <tr>
                      <td colSpan={8} style={emptyTableCellStyle}>
                        No events found in this date range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
