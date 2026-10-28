/**
 * @file components/EventBoard.jsx
 * @description Landing page — displays a filterable list of upcoming events.
 *
 * High-level responsibilities:
 *   - Fetches the event catalog from the backend via ApiService.getEvents().
 *   - Normalizes and formats raw event records for presentation.
 *   - Provides a category/date filter UI and renders the filtered results as
 *     ticket cards that link into the venue seat-map page.
 *
 * See the component JSDoc further down for the full data-flow narrative; this
 * file header exists so the file's purpose is visible at first glance.
 */

/**
 * Formats an ISO 8601 date string (e.g. "2025-10-18T19:39:40+00:00") into a
 * human-readable format (e.g. "Oct 18, 2025 • 7:39 PM"). Returns the original
 * value unchanged if it is already formatted or cannot be parsed.
 *
 * @param {string} value - Raw date string from the API.
 * @returns {string} Formatted date string, or the original value if parsing fails.
 */
function formatDate(value) {
  if (!value) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} • ${time}`;
}

/**
 * @file components/EventBoard.jsx
 * @description Landing page — displays a filterable list of upcoming events.
 *
 * Data flow:
 *  1. On mount, the component calls ApiService.getEvents() which hits the
 *     Team02 events endpoint via the Team07 gateway.
 *  2. The API may return events in one of several shapes (bare array, or an
 *     object with an `items`, `events`, or `Items` key). The component
 *     normalizes all of these into a single flat array.
 *  3. If the API call fails or returns an empty array, the component shows
 *     an empty state rather than fake events so the user isn't misled.
 *
 * Navigation to seat selection:
 *  Clicking "View Event" performs a full-page navigation to `/venue.html`
 *  (a separate static HTML page, not a React route) with the event ID and
 *  name passed as query parameters. venue.html writes the chosen seats back
 *  to localStorage under the "radford_cart" key.
 *
 * Event object field aliases (API schemas vary by team):
 *  - ID:       event.event_id  || event.id
 *  - Name:     event.event_name || event.opponent  (athletics events use "opponent")
 *  - Date:     event.date_time  || event.date
 *  - Location: event.venue_name  || event.location || event.venue
 */
import { useState, useEffect } from "react";
import ApiService from "../services/ApiService";

/**
 * EventBoard — event listing page.
 *
 * @returns {JSX.Element} A list of event cards.
 */
export default function EventBoard() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  // Free-text query matched (case-insensitive) against event_name / opponent.
  const [query, setQuery] = useState("");

  // Venue dropdown filter. "all" is a wildcard; other values are exact matches
  // against the event's venue string (venue_name / location / venue fallback).
  const [selectedVenue, setSelectedVenue] = useState("all");

  // Fetch events once on mount. If the API fails or returns nothing, show an
  // empty state — never fabricate events, since clicking a fake one lands on
  // a broken venue page and misleads the user about what's actually bookable.
  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      const { success, data } = await ApiService.getEvents();
      if (success && data) {
        // Normalize: API may return a bare array OR an object with a nested
        // array under various key names depending on the Team02 implementation
        const raw = Array.isArray(data)
          ? data
          : data.items || data.events || data.Items || [];
        // Hide Preston Hall events — not a bookable venue for this app.
        const filtered = raw.filter((e) => {
          const v = (e.venue_name || e.location || e.venue || "").toLowerCase();
          return !v.includes("preston");
        });
        setEvents(filtered);
      } else {
        setEvents([]);
      }
      setLoading(false);
    };
    fetchEvents();
  }, []);

  // Derive the unique set of venue names from the loaded events. This keeps the
  // dropdown self-updating — as backend data changes, the options reflect what's
  // actually bookable without needing a hardcoded list.
  const venueOf = (e) => e.venue_name || e.location || e.venue || "";
  const venues = Array.from(
    new Set(events.map(venueOf).filter(Boolean)),
  ).sort();

  // Apply search + venue filters. Each predicate short-circuits when its
  // control is in its wildcard state so users only narrow when they opt in.
  const filteredEvents = events.filter((e) => {
    const name = (e.event_name || e.opponent || "").toLowerCase();
    if (query && !name.includes(query.toLowerCase())) return false;
    if (selectedVenue !== "all" && venueOf(e) !== selectedVenue) return false;
    return true;
  });

  return (
    <>
      <h2 style={{ marginBottom: "1.5rem", color: "var(--radford-red)" }}>
        Browse Events
      </h2>

      {/* Search + filter toolbar. Styles live in index.css (.filter-*) so the
          controls share a consistent look across the app and stay easy to tweak. */}
      <div className="filter-bar">
        <div className="filter-search">
          <span className="filter-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events by name"
            aria-label="Search events by name"
            className="filter-search-input"
          />
        </div>
        <select
          value={selectedVenue}
          onChange={(e) => setSelectedVenue(e.target.value)}
          aria-label="Filter by venue"
          className="filter-select"
        >
          <option value="all">All venues</option>
          {venues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading-state">⏳ Loading events...</div>
      ) : filteredEvents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗓️</div>
          <p>No events match your search.</p>
        </div>
      ) : (
        filteredEvents.map((event) => (
          <div key={event.event_id || event.id} className="ticket-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <div style={{ flex: 1 }}>
                {/* Support both general events (event_name) and athletics events (opponent) */}
                <h3 className="ticket-title">
                  {event.event_name || event.opponent}
                </h3>
                <div className="ticket-meta">
                  📅 {formatDate(event.date_time || event.date)} • 📍{" "}
                  {event.venue_name || event.location || event.venue}
                </div>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "1rem" }}
              >
                {/*
                  Full-page navigation to venue.html (outside the React SPA).
                  venue.html reads event_id and event_name from the query string
                  to render the seat map, then writes the selection to localStorage.
                */}
                <button
                  className="btn-primary"
                  onClick={() => {
                    const id = event.event_id || event.id;
                    const name = event.event_name || event.opponent;
                    window.location.href = `/venue.html?event_id=${encodeURIComponent(id)}&event_name=${encodeURIComponent(name)}`;
                  }}
                >
                  View Event
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
