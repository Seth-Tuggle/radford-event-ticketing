/**
 * @file components/MyTickets.jsx
 * @description Displays the user's purchased tickets with live QR codes.
 *
 * ── Data source ──────────────────────────────────────────────────────────────
 *   Fetches SOLD tickets from the backend via GET /Group-3/tickets/my-tickets
 *   using the logged-in user's Cognito sub as owner_id. Works on any device
 *   as long as the user is logged in — no localStorage dependency.
 *
 * ── QR code fetching ─────────────────────────────────────────────────────────
 *   For each ticket returned, calls generateQRCode(ticketId, eventId).
 *   Returns a presigned S3 URL (15 min TTL) to the QR image.
 *   Tickets with status USED show an ADMITTED overlay.
 *
 * ── Post-checkout polling ────────────────────────────────────────────────────
 *   After a Stripe payment redirect, the webhook pipeline (Stripe → webhook
 *   → delete cart → DynamoDB Stream → sell-tickets) takes a few seconds.
 *   The component polls the backend at 3 s, 7 s, and 12 s after mount to
 *   pick up newly finalized tickets without requiring a manual page refresh.
 */
import { useState, useEffect, useRef } from "react";
import ApiService from "../services/ApiService";
import { getUserSub, getUserEmail } from "../auth";

/**
 * Support inbox that refund requests are mailed to. Placeholder for now —
 * replace this single constant with the real support address when the team
 * provides one. Used by the RefundRequestModal below.
 */
const REFUND_SUPPORT_EMAIL = "developer@example.com";

/** Matches UUID-shaped strings so we can hide raw IDs from the user. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/**
 * Builds a human-readable seat label from a `ticket_info` object returned by
 * the generate-qr endpoint. Tries the structured fields first (row + number
 * + tier), then falls back to the raw seat_key, then null.
 *
 * @param {Object|null} info - The `ticket_info` object from generate-qr.
 * @returns {string|null} A display label, or null when no fields are present.
 */
function buildSeatLabel(info) {
  if (!info) return null;
  const section = info.section || "";
  const row = info.row || "";
  const num = info.seat_number || "";
  const tier = info.tier || "";

  // Build the base seat identifier.
  // For GA / Dedmon Center / Banquet style (has section): show "Students Section · GA-282"
  // For standard row-based venues (no section): prefix with "Row" e.g. "Row A-4"
  let seat = "";
  if (row && num) {
    const prefix = section || row.toLowerCase() === "ga" || row.toLowerCase().startsWith("table") ? "" : "Row ";
    seat = `${prefix}${row}-${num}`;
  } else if (num) {
    seat = num;
  } else if (info.seat_key) {
    seat = info.seat_key.replace("#", "-");
  }

  // Combine section + seat + tier with dot separators.
  // Short section names (e.g. "C", "O") get a "Section" prefix for clarity;
  // descriptive names like "Students Section" are used as-is.
  const parts = [];
  if (section) {
    const needsPrefix = section.length <= 2 || /^[A-Z]{1,2}$/i.test(section);
    parts.push(needsPrefix ? `Section ${section}` : section);
  }
  if (seat) parts.push(seat);
  if (tier) parts.push(tier);
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
}

/**
 * Formats a date string (e.g. "2026-04-11") into a user-friendly form
 * (e.g. "Sat, Apr 11, 2026"). Returns null for empty/invalid input.
 *
 * @param {string|null} dateStr - ISO date or datetime string.
 * @returns {string|null} Formatted date, or null.
 */
function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    const isDateOnly = dateStr.length === 10;
    const d = new Date(isDateOnly ? dateStr + "T12:00:00" : dateStr);
    if (isNaN(d)) return dateStr;
    const date = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    // Include time only when the original string has time info
    if (isDateOnly) return date;
    const time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${date} \u00b7 ${time}`;
  } catch {
    return dateStr;
  }
}

/**
 * MyTickets — purchased-tickets page.
 *
 * Lifecycle:
 *   1. On mount, detect if this is a post-checkout redirect and clear cart.
 *   2. Fetch SOLD tickets and the events list in parallel.
 *   3. Group tickets by event_id, resolving friendly names from the events API.
 *   4. For each ticket, fetch a QR code image via /generate-qr.
 *   5. If this is a post-checkout redirect, poll at 3 s / 7 s / 12 s to catch
 *      tickets that are still being finalized by the webhook pipeline.
 *
 * @returns {JSX.Element}
 */
export default function MyTickets() {
  const [tickets, setTickets] = useState([]);
  const [qrUrls, setQrUrls] = useState({});
  const [qrStatuses, setQrStatuses] = useState({});
  const [qrSeatInfo, setQrSeatInfo] = useState({});
  /** Map ticket_id → sold_at ISO timestamp. Lets the refund email include
   * the purchase time so support can pinpoint the correct Stripe charge. */
  const [ticketSoldAt, setTicketSoldAt] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // ── Refund select-mode state ──────────────────────────────────────────
  // `selectModeEventId` is the event_id of the event currently in select
  // mode, or null when no event is in select mode. Only one event at a
  // time because a single refund maps to a single Stripe charge.
  const [selectModeEventId, setSelectModeEventId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showRefundModal, setShowRefundModal] = useState(false);
  /** Tier→price maps keyed by event_id, populated lazily on select-mode entry. */
  const [eventPrices, setEventPrices] = useState({});
  /** Tracks the initial ticket count so polling can detect new arrivals. */
  const initialCount = useRef(null);
  /** Holds the polling interval ID so we can clean it up on unmount. */
  const pollInterval = useRef(null);

  useEffect(() => {
    // ── Post-payment cleanup: clear cart after successful Stripe checkout ──
    let fromCheckout = false;
    if (sessionStorage.getItem("stripe_checkout_pending")) {
      sessionStorage.removeItem("stripe_checkout_pending");
      localStorage.removeItem("radford_cart");
      localStorage.removeItem("radford_cart_expiry");
      window.dispatchEvent(new Event("cartUpdated"));
      fromCheckout = true;
    }

    const sub = getUserSub();

    // ── Not logged in: fall back to localStorage simulated purchases ──────
    if (!sub) {
      const saved = JSON.parse(localStorage.getItem("tickets") || "[]");
      setTickets(saved);
      setLoading(false);
      fetchQRCodes(saved);
      return;
    }

    // ── Initial fetch ─────────────────────────────────────────────────────
    loadTickets(sub);

    // ── Post-checkout polling ─────────────────────────────────────────────
    // The Stripe webhook → delete cart → DynamoDB Stream → sell-tickets
    // pipeline can take 5–20 seconds. Poll every 3 seconds for up to 30
    // seconds, stopping early once new tickets are detected.
    if (fromCheckout) {
      const maxPollTime = 30000;
      const startTime = Date.now();
      pollInterval.current = setInterval(() => {
        if (Date.now() - startTime > maxPollTime) {
          clearInterval(pollInterval.current);
          return;
        }
        loadTickets(sub, true);
      }, 3000);
    }

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, []);

  /**
   * Fetches tickets and the events list, groups tickets by event, and
   * kicks off QR code fetching. Safe to call multiple times (polling).
   *
   * @param {string} sub - The user's Cognito sub UUID.
   * @param {boolean} isRetry - If true, suppresses loading/error state
   *   changes so the UI doesn't flash during background polling.
   */
  async function loadTickets(sub, isRetry = false) {
    try {
      // Fetch events list for friendly name resolution. The events API
      // returns { items: [...] } — handle both flat array and wrapper.
      const eventsPromise = ApiService.getEvents()
        .then((r) => {
          if (!r.success || !r.data) return {};
          const list = Array.isArray(r.data) ? r.data : r.data.items || [];
          const map = {};
          list.forEach((e) => {
            const id = e.event_id || e.id;
            if (id) map[id] = e;
          });
          return map;
        })
        .catch(() => ({}));

      const result = await ApiService.getMyTickets(sub);
      const eventMap = await eventsPromise;

      if (!result.success || !result.data?.tickets) {
        if (!isRetry) {
          setError("Could not load tickets. Please try again.");
          setLoading(false);
        }
        return;
      }

      // ── Group tickets by event_id ─────────────────────────────────────
      const grouped = {};
      const soldAtMap = {};
      result.data.tickets.forEach((t) => {
        const eid = t.event_id;
        if (!grouped[eid]) {
          const evt = eventMap[eid] || {};
          // Resolve a human-readable name — never show a raw UUID
          const rawName =
            t.event_name || evt.event_name || evt.title || evt.opponent || "";
          const friendlyName =
            rawName && !UUID_RE.test(rawName) ? rawName : null;
          // Only use actual event dates, not sold_at (purchase timestamp).
          // The events API uses date_time; fall back to date / event_date.
          const friendlyDate =
            evt.date_time || evt.date || evt.event_date || "";
          const friendlyVenue = t.venue || evt.venue_name || evt.location || "";

          grouped[eid] = {
            event_id: eid,
            event_name: friendlyName,
            venue: friendlyVenue,
            date_time: friendlyDate,
            ticketIds: [],
          };
        }
        grouped[eid].ticketIds.push(t.ticket_id);
        // Track sold_at per ticket for the refund email's admin lookup block.
        if (t.sold_at) soldAtMap[t.ticket_id] = t.sold_at;
      });
      setTicketSoldAt((prev) => ({ ...prev, ...soldAtMap }));

      const list = Object.values(grouped);
      const totalTickets = list.reduce((n, g) => n + g.ticketIds.length, 0);

      // Record the initial ticket count on first load; stop polling once
      // the count increases (meaning the webhook pipeline has finished).
      if (initialCount.current === null) {
        initialCount.current = totalTickets;
      } else if (totalTickets > initialCount.current && pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }

      setTickets(list);
      setLoading(false);
      fetchQRCodes(list);

      // Eager-fetch pricing for every event represented in the ticket list.
      // The refund-button gate (see refundableCount below) needs prices to
      // know whether an order was $0 — no-cost orders have no Stripe charge
      // to refund against, so the "Request Refund" button must stay hidden
      // for them. Fetching here instead of on select-mode entry avoids a
      // flicker where the button briefly appears and then disappears.
      // Uses the same ApiService call as the lazy path so the pricing cache
      // (`eventPrices`) stays consistent whichever path fills it first.
      setEventPrices((prev) => {
        list.forEach((g) => {
          if (prev[g.event_id]) return;
          ApiService.getPricingTiers(g.event_id).then((map) => {
            setEventPrices((p) =>
              p[g.event_id] ? p : { ...p, [g.event_id]: map },
            );
          });
        });
        return prev;
      });
    } catch {
      if (!isRetry) {
        setError("Could not load tickets. Please try again.");
        setLoading(false);
      }
    }
  }

  /**
   * Fires one /generate-qr request per ticket in parallel and writes the
   * result into state maps keyed by "<groupIdx>:<ticketId>".
   *
   * @param {Array} ticketList - Grouped tickets (one entry per event).
   */
  function fetchQRCodes(ticketList) {
    ticketList.forEach((ticket, i) => {
      const eventId = ticket.event_id || ticket.id;
      (ticket.ticketIds || []).forEach((ticketId) => {
        ApiService.generateQRCode(ticketId, eventId).then((result) => {
          if (!result.success || !result.data) return;
          const url =
            result.data.qr_url ||
            (result.data.qr_base64
              ? `data:image/png;base64,${result.data.qr_base64}`
              : null);
          if (url)
            setQrUrls((prev) => ({ ...prev, [`${i}:${ticketId}`]: url }));
          if (result.data.status)
            setQrStatuses((prev) => ({
              ...prev,
              [`${i}:${ticketId}`]: result.data.status,
            }));
          if (result.data.ticket_info)
            setQrSeatInfo((prev) => ({
              ...prev,
              [`${i}:${ticketId}`]: result.data.ticket_info,
            }));
        });
      });
    });
  }

  // ── Loading state ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <h2 style={{ marginBottom: "1.5rem", color: "var(--radford-red)" }}>
          My Tickets
        </h2>
        <div className="loading-state">Loading your tickets...</div>
      </>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <>
        <h2 style={{ marginBottom: "1.5rem", color: "var(--radford-red)" }}>
          My Tickets
        </h2>
        <div className="empty-state">
          <p>{error}</p>
        </div>
      </>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────────
  return (
    <>
      <h2 style={{ marginBottom: "1.5rem", color: "var(--radford-red)" }}>
        My Tickets
      </h2>

      {tickets.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#127915;</div>
          <p>No tickets yet. Purchase tickets to see them here.</p>
        </div>
      ) : (
        tickets.map((ticket, i) => {
          const ticketIds = ticket.ticketIds || [];
          const displayName = ticket.event_name || "Event";
          const displayDate = formatDate(ticket.date_time);
          const inSelectMode = selectModeEventId === ticket.event_id;
          // A ticket is refundable if:
          //   • its QR status isn't USED (USED seats are spent), AND
          //   • its price isn't $0 (no-cost orders have no Stripe charge).
          // Unknown status or unknown price is treated as refundable so the
          // button doesn't flicker while QR/pricing fetches are in flight;
          // both settle within a second or two of page load.
          const priceMap = eventPrices[ticket.event_id];
          const refundableCount = ticketIds.filter((tid) => {
            if (qrStatuses[`${i}:${tid}`] === "USED") return false;
            if (!priceMap) return true;
            const tier = qrSeatInfo[`${i}:${tid}`]?.tier;
            if (!tier) return true;
            const price = priceMap[tier];
            return !(typeof price === "number" && price === 0);
          }).length;

          return (
            <div
              key={ticket.event_id}
              className="ticket-card"
              style={{
                borderLeft: "5px solid var(--radford-red)",
                padding: "1.25rem 1.5rem",
              }}
            >
              {/* ── Event header ──────────────────────────────────────── */}
              <div
                style={{
                  marginBottom: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "1rem",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "1.15rem",
                      fontWeight: 700,
                      color: "var(--black)",
                      lineHeight: 1.3,
                    }}
                  >
                    {displayName}
                  </h3>
                  {(displayDate || ticket.venue) && (
                    <div
                      style={{
                        marginTop: "0.3rem",
                        fontSize: "0.88rem",
                        color: "var(--neutral-grey)",
                        lineHeight: 1.5,
                      }}
                    >
                      {displayDate &&
                        (() => {
                          const parts = displayDate.split(" \u00b7 ");
                          return (
                            <>
                              {"\uD83D\uDCC5"} {parts[0]}
                              {parts[1] && (
                                <>
                                  {" \u2022 "}
                                  {"\uD83D\uDD50"} {parts[1]}
                                </>
                              )}
                            </>
                          );
                        })()}
                      {displayDate && ticket.venue && " \u2022 "}
                      {ticket.venue && <>{"\uD83D\uDCCD"} {ticket.venue}</>}
                    </div>
                  )}
                </div>
                {/* Request Refund toggle — hidden if no refundable tickets */}
                {refundableCount > 0 && (
                  <button
                    onClick={() => {
                      if (inSelectMode) {
                        // Cancel select mode
                        setSelectModeEventId(null);
                        setSelectedIds([]);
                      } else {
                        // Enter select mode for this event; fetch pricing if unknown
                        setSelectModeEventId(ticket.event_id);
                        setSelectedIds([]);
                        if (!eventPrices[ticket.event_id]) {
                          ApiService.getPricingTiers(ticket.event_id).then(
                            (map) => {
                              setEventPrices((prev) => ({
                                ...prev,
                                [ticket.event_id]: map,
                              }));
                            },
                          );
                        }
                      }
                    }}
                    style={{
                      flexShrink: 0,
                      background: inSelectMode ? "#fff" : "transparent",
                      color: "var(--radford-red)",
                      border: "1px solid var(--radford-red)",
                      borderRadius: "6px",
                      padding: "0.4rem 0.85rem",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inSelectMode ? "Cancel" : "Request Refund"}
                  </button>
                )}
              </div>

              {/* ── QR code grid ─────────────────────────────────────── */}
              {ticketIds.length > 0 && (
                <div className="qr-grid">
                  {ticketIds.map((ticketId) => {
                    const key = `${i}:${ticketId}`;
                    const url = qrUrls[key];
                    const isUsed = qrStatuses[key] === "USED";
                    const seatLabel = buildSeatLabel(qrSeatInfo[key]);
                    const isSelected =
                      inSelectMode && selectedIds.includes(ticketId);
                    // Click handler only active in select mode, and only for non-USED tickets.
                    const selectable = inSelectMode && !isUsed;
                    const onTileClick = selectable
                      ? () => {
                          setSelectedIds((prev) =>
                            prev.includes(ticketId)
                              ? prev.filter((x) => x !== ticketId)
                              : [...prev, ticketId],
                          );
                        }
                      : undefined;

                    return (
                      <div
                        key={ticketId}
                        onClick={onTileClick}
                        style={{
                          background: "#fff",
                          borderRadius: "var(--radius)",
                          padding: "0.75rem",
                          textAlign: "center",
                          border: isSelected
                            ? "2px solid var(--radford-red)"
                            : "1px solid #e5e7eb",
                          cursor: selectable ? "pointer" : "default",
                          opacity: inSelectMode && isUsed ? 0.5 : 1,
                          transition: "border-color 0.15s",
                        }}
                      >
                        {/* QR image container */}
                        <div
                          style={{
                            width: 140,
                            height: 140,
                            margin: "0 auto",
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "6px",
                            overflow: "hidden",
                            background: "#fafafa",
                          }}
                        >
                          {url ? (
                            <>
                              <img
                                src={url}
                                alt={`QR code${seatLabel ? ` for seat ${seatLabel}` : ""}`}
                                style={{
                                  width: 130,
                                  height: 130,
                                  display: "block",
                                  opacity: isUsed ? 0.35 : 1,
                                }}
                              />
                              {isUsed && (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: "50%",
                                    left: "50%",
                                    transform:
                                      "translate(-50%, -50%) rotate(-20deg)",
                                    background: "#16a34a",
                                    color: "#fff",
                                    fontWeight: 700,
                                    fontSize: "0.8rem",
                                    padding: "0.25rem 0.65rem",
                                    borderRadius: "4px",
                                    whiteSpace: "nowrap",
                                    letterSpacing: "0.5px",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Admitted
                                </div>
                              )}
                            </>
                          ) : (
                            <div
                              style={{
                                fontSize: "2rem",
                                color: "var(--neutral-grey)",
                              }}
                            >
                              &#9203;
                            </div>
                          )}
                        </div>

                        {/* Seat label — only rendered when available */}
                        {seatLabel && (
                          <div
                            style={{
                              marginTop: "0.45rem",
                              fontSize: "0.8rem",
                              fontWeight: 600,
                              color: "var(--black)",
                            }}
                          >
                            {seatLabel}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Ticket count ─────────────────────────────────────── */}
              <div
                style={{
                  marginTop: "0.75rem",
                  fontSize: "0.78rem",
                  color: "var(--neutral-grey)",
                }}
              >
                {ticketIds.length} ticket{ticketIds.length !== 1 ? "s" : ""}
              </div>
            </div>
          );
        })
      )}

      {/* ── Floating select-mode banner ──────────────────────────────────── */}
      {selectModeEventId &&
        selectedIds.length > 0 &&
        (() => {
          const activeIdx = tickets.findIndex(
            (t) => t.event_id === selectModeEventId,
          );
          const priceMap = eventPrices[selectModeEventId] || {};
          let total = 0;
          let priceKnown = true;
          selectedIds.forEach((tid) => {
            const info = qrSeatInfo[`${activeIdx}:${tid}`];
            const tier = info?.tier;
            const price = tier ? priceMap[tier] : undefined;
            if (price === undefined) priceKnown = false;
            else total += price;
          });
          return (
            <div
              style={{
                position: "fixed",
                bottom: "1.5rem",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#0f172a",
                color: "#fff",
                borderRadius: "12px",
                padding: "0.9rem 1.25rem",
                display: "flex",
                alignItems: "center",
                gap: "1.25rem",
                boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
                zIndex: 100,
                maxWidth: "calc(100vw - 2rem)",
              }}
            >
              <div style={{ fontSize: "0.9rem" }}>
                <strong>{selectedIds.length}</strong> selected
                {priceKnown && (
                  <span style={{ opacity: 0.75, marginLeft: "0.5rem" }}>
                    &middot; Total: ${total.toFixed(2)}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setSelectModeEventId(null);
                  setSelectedIds([]);
                }}
                style={{
                  background: "transparent",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.3)",
                  borderRadius: "6px",
                  padding: "0.4rem 0.85rem",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => setShowRefundModal(true)}
                style={{
                  background: "var(--radford-red)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.45rem 1rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Request Refund
              </button>
            </div>
          );
        })()}

      {/* ── Refund confirmation modal ────────────────────────────────────── */}
      {showRefundModal && selectModeEventId && (
        <RefundRequestModal
          eventCard={tickets.find((t) => t.event_id === selectModeEventId)}
          selectedIds={selectedIds}
          qrSeatInfo={qrSeatInfo}
          eventIdx={tickets.findIndex((t) => t.event_id === selectModeEventId)}
          priceMap={eventPrices[selectModeEventId] || {}}
          ticketSoldAt={ticketSoldAt}
          onClose={() => setShowRefundModal(false)}
          onSent={() => {
            // Email client has been handed the mailto: — treat that as
            // confirmation. Close modal and exit select mode.
            setShowRefundModal(false);
            setSelectModeEventId(null);
            setSelectedIds([]);
          }}
        />
      )}
    </>
  );
}

/**
 * RefundRequestModal — summary + email input + Send Refund Request.
 *
 * The Send button is a real anchor with a `mailto:` href, so clicking it
 * opens the user's default email client with the refund request pre-populated
 * (support address, subject, body with event name, ticket IDs, and a prompt
 * to fill in the reason). The modal closes immediately — the email client
 * opening is the user's confirmation.
 */
function RefundRequestModal({
  eventCard,
  selectedIds,
  qrSeatInfo,
  eventIdx,
  priceMap,
  ticketSoldAt,
  onClose,
  onSent,
}) {
  const loginEmail = getUserEmail() || "";
  const [email, setEmail] = useState(loginEmail);

  const eventName = eventCard?.event_name || "Event";
  const lineItems = selectedIds.map((tid) => {
    const info = qrSeatInfo[`${eventIdx}:${tid}`] || {};
    const row = info.row || "";
    const num = info.seat_number || "";
    const tier = info.tier || "";
    const label = row && num ? `${row}-${num}` : info.seat_key || tid;
    const price = tier ? priceMap[tier] : undefined;
    return { tid, label, tier, price };
  });
  const priceKnown = lineItems.every((li) => typeof li.price === "number");
  const total = priceKnown
    ? lineItems.reduce((s, li) => s + li.price, 0)
    : null;

  // Build the mailto body — plain text, decoded in the user's email client.
  // The admin-facing section at the bottom includes a pre-filtered Stripe
  // Dashboard link (filtered by checkout email + approximate purchase date)
  // and the exact metadata key/value they need to paste on the charge detail
  // page before clicking Refund.
  const checkoutEmail = email || "[please fill in]";
  const stripeLookup = email
    ? `https://dashboard.stripe.com/test/payments?email=${encodeURIComponent(email)}`
    : "https://dashboard.stripe.com/test/payments";

  // Derive the approximate purchase timestamp from sold_at of the selected
  // tickets. Usually identical (one checkout session); take the earliest.
  const soldTimestamps = selectedIds
    .map((tid) => ticketSoldAt?.[tid])
    .filter(Boolean)
    .sort();
  const purchaseDateStr =
    soldTimestamps.length > 0 ? formatDate(soldTimestamps[0]) : null;

  const body = [
    "Hi,",
    "",
    `I'd like to request a refund for the following ticket${selectedIds.length > 1 ? "s" : ""}:`,
    "",
    `Event: ${eventName}`,
    " ",
    ...lineItems.map(
      (li) =>
        `- ${li.label}${li.tier ? ` (${li.tier}${li.price !== undefined ? ` \u2013 $${li.price.toFixed(2)}` : ""})` : ""}`,
    ),
    "",
    `Email used at Stripe checkout: ${checkoutEmail}`,
    "",
    "Reason for refund: [PLEASE FILL IN]",
    "",
    "Thanks!",
    "",
    "------------------------------------------------------------",
    "",
    "Support \u2014 please complete the following steps in Stripe:",
    "",
    "Step 1 \u2014 Open the Stripe payment",
    `   - ${stripeLookup}`,
    purchaseDateStr ? `   - Filter by purchase date: ${purchaseDateStr}` : null,
    "",
    "Step 2 \u2014 Add ticket metadata",
    "   - Click the payment row \u2192 Metadata panel \u2192 Edit \u2192 Add:",
    "      - key:    ticket_ids",
    `      - value:  ${selectedIds.join(",")}`,
    "   - Save, then hard-refresh to confirm the value appears.",
    "",
    "Step 3 \u2014 Issue the refund",
    "   - Click Refund at the top of the payment view.",
    "   - Seats release automatically once Stripe fires the webhook.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const subject =
    selectedIds.length === 1
      ? `Refund request \u2014 ${selectedIds[0]}`
      : `Refund request \u2014 ${selectedIds.length} seats (${eventName})`;

  const mailtoHref =
    `mailto:${REFUND_SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "1.5rem 1.75rem",
          maxWidth: "460px",
          width: "100%",
          boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "1.2rem",
            fontWeight: 700,
            color: "var(--black)",
          }}
        >
          Request Refund
        </h3>
        <div
          style={{
            color: "var(--neutral-grey)",
            fontSize: "0.88rem",
            marginTop: "0.2rem",
          }}
        >
          {eventName}
        </div>

        {/* Line items */}
        <div
          style={{
            marginTop: "1.1rem",
            padding: "0.85rem 1rem",
            background: "#f8f9fb",
            borderRadius: "8px",
            fontSize: "0.9rem",
          }}
        >
          {lineItems.map((li) => (
            <div
              key={li.tid}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.2rem 0",
              }}
            >
              <span>Seat {li.label}</span>
              <span style={{ color: "var(--neutral-grey)" }}>
                {li.tier}
                {li.price !== undefined
                  ? ` \u00b7 $${li.price.toFixed(2)}`
                  : ""}
              </span>
            </div>
          ))}
          {priceKnown && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid #e5e7eb",
                marginTop: "0.5rem",
                paddingTop: "0.5rem",
                fontWeight: 700,
              }}
            >
              <span>Total refund</span>
              <span style={{ color: "var(--radford-red)" }}>
                ${total.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Email input */}
        <label
          style={{
            display: "block",
            marginTop: "1.1rem",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          Email used at Stripe checkout
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            width: "100%",
            padding: "0.55rem 0.75rem",
            marginTop: "0.35rem",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "0.9rem",
            boxSizing: "border-box",
          }}
        />
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--neutral-grey)",
            marginTop: "0.35rem",
          }}
        >
          If you paid with a different email than your login, update it here so
          our support team can find your payment.
        </div>

        {/* Actions */}
        <div
          style={{
            marginTop: "1.25rem",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.6rem",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              color: "var(--black)",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              padding: "0.5rem 1rem",
              fontSize: "0.88rem",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <a
            href={mailtoHref}
            onClick={onSent}
            style={{
              background: "var(--radford-red)",
              color: "#fff",
              borderRadius: "6px",
              padding: "0.55rem 1.1rem",
              fontSize: "0.88rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Send Refund Request
          </a>
        </div>
      </div>
    </div>
  );
}
