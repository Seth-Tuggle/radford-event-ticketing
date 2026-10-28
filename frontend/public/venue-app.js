/**
 * @file venue-app.js
 * @description Interactive seat-selection page for the Radford Events Ticketing system.
 *
 * This script powers venue.html. It handles:
 *   1. Reading an `event_id` query parameter from the URL.
 *   2. Fetching live event metadata, available seats, pricing, and discount data
 *      from the shared AWS API Gateway (Team02 and Team03 endpoints).
 *   3. Dynamically rendering one of three seating layouts — Classroom, Theater,
 *      or Banquet — based on the event's configured venue style.
 *   4. Allowing the user to click seats to select or deselect them.
 *   5. Persisting the user's seat selection to `localStorage` under the key
 *      `"radford_cart"` so that index.html can read and display the cart.
 *
 * ── How to open this page ─────────────────────────────────────────────────────
 *   Open venue.html with a query string, e.g.:
 *     venue.html?event_id=demo-event-001&event_name=Taylor%20Swift%20Concert
 *
 *   Both parameters are optional for display; `event_id` drives all API calls.
 *   Without `event_id` the page renders an error state and hides the seat map.
 *
 * ── Cart data stored in localStorage ("radford_cart") ────────────────────────
 *   Array of objects. Each object represents one event in the cart:
 *   {
 *     id:            string,    // event_id — used as a unique cart key
 *     eventId:       string,    // same as id; kept for index.html compatibility
 *     opponent:      string,    // event title shown in the cart
 *     date:          string,    // formatted date, e.g. "Oct 15, 2026"
 *     time:          string,    // formatted time, e.g. "3:00 PM"
 *     venue:         string,    // venue name from event metadata
 *     price:         number,    // effective ticket price after any discounts
 *     quantity:      number,    // number of seats selected
 *     seats:         string[],  // seat labels, e.g. ["Row A-1", "Table B-5"]
 *     fromVenuePage: true       // tells index.html to show the "Edit Seats" link
 *   }
 *
 * ── API endpoints used ────────────────────────────────────────────────────────
 *   Base URL: https://service.example.invalid/production
 *
 *   GET /Group-2/events/:id
 *     → Fetch metadata for a single event (name, date, venue, layout).
 *   GET /Group-2/events?event_id=:id
 *     → Fallback if the direct endpoint returns 403.
 *   GET /Group-3/tickets/available-tickets?event_id=:id
 *     → Returns all unsold seat records. Each has a `seat_key` field
 *       (e.g. "A#3" or "Table B#7") that maps to a rendered seat element.
 *   GET /Group-3/pricing-tiers?event_id=:id
 *     → Returns pricing tiers. This app uses the "Standard" tier.
 *   GET /Group-3/tickets/discounts?event_id=:id
 *     → Returns active discounts. If a "Standard" discount exists, it
 *       overrides the base price and shows a savings message in the checkout bar.
 *
 * ── No build step required ────────────────────────────────────────────────────
 *   Plain JavaScript — no npm, no bundler. Loaded via:
 *   <script src="venue-app.js"> at the bottom of venue.html.
 */

/** AWS API Gateway base URL shared across all team routes. */
const API_BASE =
  "https://service.example.invalid/production";

/* =============================================================
   LAYOUT SWITCHING
   The page contains three hidden <div> venue containers:
   #classroom, #theater, and #banquet. Only one is visible at
   a time (the one with class "active"). showLayout() swaps
   which one is visible when the user clicks a layout tab button.
   ============================================================= */

/**
 * Switches the visible seating layout and highlights the active tab button.
 *
 * @param {string} layoutId - The id of the venue container to show.
 *   Must be one of: 'classroom', 'theater', 'banquet'.
 * @param {HTMLButtonElement} btnElement - The tab button that was clicked.
 *   Its "active" class is set; all other tab buttons are cleared.
 */
function showLayout(layoutId, btnElement) {
  // Hide every layout, then show only the requested one
  document
    .querySelectorAll(".venue-container")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".layout-selector button")
    .forEach((btn) => btn.classList.remove("active"));

  document.getElementById(layoutId).classList.add("active");
  btnElement.classList.add("active");

  // Banquet tables are inherently wheelchair-accessible — hide the legend item
  const accessibleLegend = document.getElementById("legend-accessible");
  if (accessibleLegend)
    accessibleLegend.style.display = layoutId === "banquet" ? "none" : "";
}

/* =============================================================
   CHECKOUT STATE
   These module-level variables track the number of seats the
   user has selected and the price fetched from the API. They
   are updated on every seat click via toggleSeatSetup() and
   read by updateCheckoutUI() to refresh the sticky bar at the
   bottom of the page.
   ============================================================= */

/** Running count of seats the user has clicked into the selected state. */
let selectedTicketsCount = 0;

/** Map of seat_key → tier name for all currently selected seats. */
let selectedSeats = {};

/** Map of seat_key → tier name for the last saved cart state (used to detect changes). */
let lastSavedSeats = {};

/** Whether the current event is already in the user's cart. */
let isInCart = false;

/** Effective price per ticket — base price overridden by any active discount. */
let TICKET_PRICE = 0.0;

/** Original (pre-discount) price per ticket, used for savings calculation. */
let ORIGINAL_TICKET_PRICE = 0.0;

/** True when a discount is currently active for the "Standard" pricing tier. */
let IS_DISCOUNTED = false;

/** Map of tier name → price (e.g. { VIP: 50, Standard: 25, Budget: 15 }). */
let tierPrices = {};

/** Map of tier name → original price before discounts (for savings calculation). */
let tierOriginalPrices = {};

/** Map of seat_key → disability flag (e.g. { "A#1": true, "A#2": false }). */
let seatDisabilityMap = {};

/** Full event metadata returned by the Group-2 API, stored for cart construction. */
let currentEventData = null;

/** Subscription state — tracks if the user has subscribed to notifications for this event. */
let isSubscribed = false;

/**
 * Returns a localStorage key uniquely scoped to the (user email, SNS topic
 * ARN) pair. Used to remember which events the current user has already
 * subscribed to so the "Get Notified" button can render in its "Subscribed"
 * state on subsequent visits without a backend round-trip.
 *
 * Two related keys are also written using this base key plus suffixes:
 *   <key>:pending — "true" while AWS is awaiting email confirmation
 *   <key>:arn     — the SNS subscription ARN, written once confirmed
 *
 * @param {string} email    - The logged-in user's email address.
 * @param {string} topicArn - The event's SNS topic ARN.
 * @returns {string} A localStorage key like "sns_subscribed:developer@example.com:arn:aws:sns:..."
 */
function subscriptionKey(email, topicArn) {
  return `sns_subscribed:${email}:${topicArn}`;
}

/** SNS Topic ARN for the current event (for subscribing to notifications). */
let eventNotificationArn = null;

/* =============================================================
   GENERAL ADMISSION (GA) SECTIONS — DEDMON CENTER
   This section owns all state for Dedmon Center's section-based GA model.
   ============================================================= */

/** Dedmon Center section configuration: section letter → { capacity } */
const DEDMON_SECTIONS = {
  A: { capacity: 100 },
  B: { capacity: 225 },
  C: { capacity: 350 },
  D: { capacity: 225 },
  E: { capacity: 100 },
  F: { capacity: 150 },
  G: { capacity: 300 },
  H: { capacity: 150 },
  I: { capacity: 100 },
  J: { capacity: 225 },
  K: { capacity: 350 },
  L: { capacity: 225 },
  M: { capacity: 100 },
  N: { capacity: 150 },
  O: { capacity: 300 },
  P: { capacity: 150 },
};

/** True if the current event is Dedmon Center (GA sections). */
let isDedmonCenter = false;

/* =============================================================
   GRADUATION LAYOUT — DEDMON CENTER (Graduation ceremony)
   Reuses the Dedmon "All Section" 16-section grid (A–P around a
   central court) with a small set of per-section overrides applied
   at render time:
     • Center court label is replaced with "STUDENT SECTION".
     • A, E, F, H, I, J, K, L, M, N, P are forced to render in the
       "unavailable" state using the legend's Unavailable swatch.
     • Tiers: A/B/C → Standard, D/E → VIP. Other sections (G, O)
       keep whatever tier the backend returns (default: Standard).
   The section set and capacities mirror DEDMON_SECTIONS exactly so
   ticket fetches, the GA editor, and the cart machinery all work
   against the "All Section" Lambda contract without change.
   ============================================================= */

/**
 * Sections that are always rendered unavailable in the Graduation layout.
 * They use the legend's "Unavailable" grey instead of tier tinting so the
 * UI matches the reference mockup. (I, J, K, L, M are NOT in this set —
 * those grid cells are replaced by the Graduation Stage banner.)
 */
const GRADUATION_FORCED_UNAVAILABLE = new Set(["A", "E", "F", "H", "N", "P"]);

/**
 * Sections that are not rendered at all in the Graduation layout — their
 * grid cells (row 5, cols 2–6) are occupied by the Graduation Stage banner.
 */
const GRADUATION_HIDDEN_SECTIONS = new Set(["I", "J", "K", "L", "M"]);

/**
 * Tier overrides for the Graduation layout. Any section not listed keeps
 * the tier returned by the backend (defaulting to "Standard").
 */
const GRADUATION_TIER_OVERRIDES = {
  B: "Standard",
  C: "Standard",
  D: "Standard",
  G: "VIP",
  O: "VIP",
};

/** True if the current event is the Dedmon Center Graduation layout. */
let isGraduation = false;

/** True if the user already owns a Students Section ticket for this event (blocks repurchase). */
let studentsSectionAlreadyOwned = false;

/** Full raw ticket array returned by API — used to filter and pluck exact seat_keys for GA sections. */
let allAvailableTickets = [];

/** GA selections per section: { section: { quantity, disabilityQuantity, tier, section } } */
let selectedGASections = {};

/** Currently active GA section (only one can have controls visible at a time). */
let activeGASection = null;

/**
 * Calculates the total price of all currently selected seats based on their tiers.
 *
 * @returns {number} The sum of all selected seat prices.
 */
function calculateSelectedTotal() {
  let total = 0;
  Object.values(selectedSeats).forEach((tier) => {
    const price = tierPrices[tier] || 0;
    total += price;
  });
  return total;
}

/**
 * Calculates the total discount savings across all selected seats.
 *
 * @returns {number} The total amount saved by discounts.
 */
function calculateSavings() {
  let savings = 0;
  Object.values(selectedSeats).forEach((tier) => {
    const originalPrice = tierOriginalPrices[tier] || 0;
    const currentPrice = tierPrices[tier] || 0;
    savings += Math.max(0, originalPrice - currentPrice);
  });
  return savings;
}

/**
 * Checks if the current selection differs from the last saved state.
 *
 * @returns {boolean} True if seats have been modified since last save.
 */
function hasSelectionChanged() {
  const currentKeys = Object.keys(selectedSeats).sort();
  const savedKeys = Object.keys(lastSavedSeats).sort();

  if (currentKeys.length !== savedKeys.length) return true;

  for (let i = 0; i < currentKeys.length; i++) {
    if (
      currentKeys[i] !== savedKeys[i] ||
      selectedSeats[currentKeys[i]] !== lastSavedSeats[savedKeys[i]]
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Updates the "Add to Cart" / "Added to Cart" / "Modify Cart" button text and state based on
 * whether the event is in the cart and if the selection has changed.
 */
function updateCheckoutButtonState() {
  const btnEl = document.getElementById("btn-checkout");
  if (!btnEl) return;

  if (isInCart && hasSelectionChanged()) {
    // Event is in cart and selection has changed → show "Modify Cart" enabled
    btnEl.innerText = "Modify Cart";
    btnEl.disabled = false;
  } else if (isInCart && !hasSelectionChanged()) {
    // Event is in cart and nothing changed → show "Added to Cart" disabled
    btnEl.innerText = "Added to Cart";
    btnEl.disabled = true;
  } else {
    // Default: show "Add to Cart"
    btnEl.innerText = "Add to Cart";
    // Disable if no seats selected
    btnEl.disabled = selectedTicketsCount === 0;
  }
}

/**
 * Refreshes the sticky checkout bar at the bottom of the page.
 * Updates: seat count label, running total, and the enabled/disabled
 * state of the "Add to Cart" button.
 */
function updateCheckoutUI() {
  const countEl = document.getElementById("ticket-count");
  const totalEl = document.getElementById("ticket-total");

  if (countEl && totalEl) {
    countEl.innerText = selectedTicketsCount + " Ticket(s) Selected";
    const total = calculateSelectedTotal().toFixed(2);
    let htmlContent = "Total: $" + total;

    const savings = calculateSavings();
    if (savings > 0) {
      htmlContent +=
        '<br><span class="savings-message">you\'re saving $' +
        savings.toFixed(2) +
        "!</span>";
    }

    totalEl.innerHTML = htmlContent;
  }

  updateCheckoutButtonState();
}

/**
 * Renders pricing information in the checkout bar.
 * With tiered pricing, no per-ticket display is needed since prices vary.
 */
function updatePricingDisplay() {
  // Pricing is now shown only in the total line
  // No additional per-ticket price display needed
}

/**
 * Keeps the "🛒 Cart (N)" nav button count accurate.
 *
 * The count displayed is: total quantity of all items actually saved in the cart
 * (from localStorage). Pending selections on this page are NOT included until
 * the user clicks "Add to Cart" or "Modify Cart".
 */
function updateNavCartCount() {
  const navBtn = document.getElementById("nav-cart-btn");
  if (!navBtn) return;

  let cartCount = 0;
  try {
    // Sum quantities of all items actually in the cart (from localStorage)
    const stored = JSON.parse(localStorage.getItem("radford_cart") || "[]");
    cartCount = stored.reduce((n, item) => n + (item.quantity || 1), 0);
  } catch (e) {}

  navBtn.innerText = `🛒 Cart (${cartCount})`;
}

/* =============================================================
   SEAT INTERACTION
   Each seat is rendered as a <div class="seat">. Clicking a seat
   calls toggleSeatSetup(), which toggles the "selected" CSS class
   and updates the running count. Seats with class "unavailable"
   are already sold and are not interactive.
   ============================================================= */

/**
 * Handles a click on a seat element: toggles its selection state and
 * updates the checkout bar. Tracks selected seats by their tier for pricing.
 *
 * @param {HTMLElement} seatElement - The seat <div> that was clicked.
 *   Does nothing if the seat carries the "unavailable" class (already sold).
 */
function toggleSeatSetup(seatElement) {
  if (seatElement.classList.contains("unavailable")) return;

  // Construct the seat key for tracking in selectedSeats
  let seatKey = "";
  const tier = seatElement.dataset.tier || "Standard";

  // For classroom/theater seats, construct "Row#Num" format
  const row = seatElement.closest(".seating-row");
  if (row) {
    const rowLabel =
      row.querySelector(".row-label")?.innerText?.replace("Row ", "") || "";
    seatKey = `${rowLabel}#${seatElement.innerText}`;
  }

  // For banquet seats, construct "Table#Num" format
  const tableContainer = seatElement.closest(".table-container");
  if (tableContainer) {
    const tableLabel =
      tableContainer.querySelector(".banquet-table")?.innerText?.trim() || "";
    seatKey = `${tableLabel}#${seatElement.innerText}`;
  }

  if (seatElement.classList.contains("selected")) {
    seatElement.classList.remove("selected");
    selectedTicketsCount--;
    delete selectedSeats[seatKey]; // Remove from tier tracking
  } else {
    seatElement.classList.add("selected");
    selectedTicketsCount++;
    selectedSeats[seatKey] = tier; // Track by tier
  }

  updateCheckoutUI();
  updateNavCartCount();
}

/**
 * Creates a single seat <div> element and attaches a click listener to it.
 *
 * @param {number|string} number - The seat number displayed inside the element.
 * @param {string} classNames - Space-separated CSS classes to apply.
 *   Example: 'seat seat-grid-item classroom-seat'
 * @param {string} [status='AVAILABLE'] - Pass any non-'AVAILABLE' string (e.g. 'SOLD')
 *   to render the seat as greyed-out and non-interactive.
 * @param {string} [tier='Standard'] - The pricing tier for this seat ('VIP', 'Standard', 'Budget').
 *   Used to apply the appropriate tier CSS class.
 * @param {boolean} [isDisability=false] - Whether this is a disability-accessible seat.
 * @returns {HTMLElement} The fully configured seat <div>.
 */
function createSeat(
  number,
  classNames,
  status = "AVAILABLE",
  tier = "Standard",
  isDisability = false,
) {
  const seat = document.createElement("div");
  seat.className = classNames;
  seat.innerText = number;
  seat.dataset.tier = tier; // Store tier in data attribute for pricing lookups

  if (status !== "AVAILABLE") {
    seat.classList.add("unavailable");
  } else {
    // Apply tier-specific styling only to available seats
    const tierClass = `${tier.toLowerCase()}-seat`;
    seat.classList.add(tierClass);
  }

  // Add disability symbol overlay if this is a disability seat
  if (isDisability) {
    seat.classList.add("disability-accessible");
  }

  seat.addEventListener("click", () => toggleSeatSetup(seat));
  return seat;
}

/* =============================================================
   LAYOUT GENERATORS
   These three functions build the seating charts inside the
   pre-existing container elements in venue.html:
     #classroom-seating, #theater-seating, #banquet-seating

   They are called once during initialisation after the available
   seat keys have been fetched from the API.

   Seat key format (agreed with Team03):
     Classroom / Theater:  "<RowLetter>#<SeatNumber>"   e.g. "A#3"
     Banquet:              "Table <Letter>#<SeatNum>"   e.g. "Table B#7"

   If availableKeys is null (API unreachable), all seats are rendered
   as available so the page still shows a usable layout.
   ============================================================= */

/**
 * Generates the Classroom layout — 10 rows (A–J), split into left and right
 * groups with an aisle gap in the middle. Some rows have an extra seat on
 * the left side to reflect the real room configuration.
 *
 * @param {Set<string>|null} availableKeys - Set of seat key strings returned
 *   by the tickets API (e.g. Set { "A#1", "A#2", … }). Pass null to render
 *   all seats as available (used when the API is unreachable).
 * @param {Object} seatTierMap - Map of seat_key to tier name. Used to apply
 *   tier-based styling to each seat.
 */
function generateClassroom(
  availableKeys,
  seatTierMap = {},
  seatDisabilityMap = {},
) {
  const container = document.getElementById("classroom-seating");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (let r = 0; r < 10; r++) {
    // Rows C–F (index 2–5) and row J (index 9) have 9 seats on the left;
    // all other rows have 8. This matches the physical room layout.
    const leftCount = (r >= 2 && r <= 5) || r === 9 ? 9 : 8;
    const rightCount = 9;
    const rowLabel = alphabet[r]; // 'A', 'B', … 'J'

    const rowEl = document.createElement("div");
    rowEl.className = "seating-row";

    // Row identifier label shown to the left of the seat groups
    const label = document.createElement("div");
    label.className = "row-label";
    label.innerText = `Row ${rowLabel}`;
    rowEl.appendChild(label);

    // Left seat group: seats 1 through leftCount
    const leftGroup = document.createElement("div");
    leftGroup.className = "seat-group";
    leftGroup.style.width = leftCount * 40 + "px";
    for (let s = 1; s <= leftCount; s++) {
      const seatKey = `${rowLabel}#${s}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      const isDisability = seatDisabilityMap[seatKey] || false;
      leftGroup.appendChild(
        createSeat(
          s,
          "seat seat-grid-item classroom-seat",
          status,
          tier,
          isDisability,
        ),
      );
    }

    // Visual aisle gap between the two seat groups
    const gap = document.createElement("div");
    gap.className = "seat-gap";

    // Right seat group: numbered leftCount+1 onward to keep row numbering continuous
    const rightGroup = document.createElement("div");
    rightGroup.className = "seat-group";
    rightGroup.style.width = rightCount * 40 + "px";
    for (let s = 1; s <= rightCount; s++) {
      const seatNum = s + leftCount; // Continue numbering from where left group ended
      const seatKey = `${rowLabel}#${seatNum}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      const isDisability = seatDisabilityMap[seatKey] || false;
      rightGroup.appendChild(
        createSeat(
          seatNum,
          "seat seat-grid-item classroom-seat",
          status,
          tier,
          isDisability,
        ),
      );
    }

    rowEl.appendChild(leftGroup);
    rowEl.appendChild(gap);
    rowEl.appendChild(rightGroup);
    container.appendChild(rowEl);
  }
}

/**
 * Generates the Theater layout — 12 rows (A–L) with a curved stadium shape:
 * front rows are narrower, widen toward the middle, then narrow again at the back.
 *
 * @param {Set<string>|null} availableKeys - Set of seat key strings from the
 *   tickets API. Pass null to render all seats as available.
 * @param {Object} seatTierMap - Map of seat_key to tier name. Used to apply
 *   tier-based styling to each seat.
 */
function generateTheater(
  availableKeys,
  seatTierMap = {},
  seatDisabilityMap = {},
) {
  const container = document.getElementById("theater-seating");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Each entry defines how many seats appear on each side of the center aisle.
  // The pattern widens from the front (row A = 6+6) to a middle block (10+10),
  // then mirrors back to narrow at the rear (row L = 6+6).
  const rowConfigs = [
    { left: 6, right: 6 },
    { left: 7, right: 7 },
    { left: 8, right: 8 },
    { left: 9, right: 9 },
    { left: 10, right: 10 },
    { left: 10, right: 10 },
    { left: 10, right: 10 },
    { left: 10, right: 10 },
    { left: 9, right: 9 },
    { left: 8, right: 8 },
    { left: 7, right: 7 },
    { left: 6, right: 6 },
  ];

  rowConfigs.forEach((config, idx) => {
    const rowLabel = alphabet[idx];
    const rowEl = document.createElement("div");
    rowEl.className = "seating-row";

    const label = document.createElement("div");
    label.className = "row-label";
    label.innerText = `Row ${rowLabel}`;
    rowEl.appendChild(label);

    const leftGroup = document.createElement("div");
    leftGroup.className = "seat-group";
    leftGroup.style.width = config.left * 40 + "px";
    for (let s = 1; s <= config.left; s++) {
      const seatKey = `${rowLabel}#${s}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      const isDisability = seatDisabilityMap[seatKey] || false;
      leftGroup.appendChild(
        createSeat(
          s,
          "seat seat-grid-item theater-seat",
          status,
          tier,
          isDisability,
        ),
      );
    }

    const gap = document.createElement("div");
    gap.className = "seat-gap";

    const rightGroup = document.createElement("div");
    rightGroup.className = "seat-group";
    rightGroup.style.width = config.right * 40 + "px";
    for (let s = 1; s <= config.right; s++) {
      const seatNum = s + config.left; // Continue seat numbering past the aisle
      const seatKey = `${rowLabel}#${seatNum}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      const isDisability = seatDisabilityMap[seatKey] || false;
      rightGroup.appendChild(
        createSeat(
          seatNum,
          "seat seat-grid-item theater-seat",
          status,
          tier,
          isDisability,
        ),
      );
    }

    rowEl.appendChild(leftGroup);
    rowEl.appendChild(gap);
    rowEl.appendChild(rightGroup);
    container.appendChild(rowEl);
  });
}

/**
 * Generates the Banquet layout — 15 round tables (A–O), each surrounded by
 * 10 seats arranged in a circle using absolute positioning and trigonometry.
 *
 * @param {Set<string>|null} availableKeys - Set of seat key strings from the
 *   tickets API. Keys use the format "Table <Letter>#<seatNum>", e.g. "Table A#1".
 *   Pass null to render all seats as available.
 * @param {Object} seatTierMap - Map of seat_key to tier name. Used to apply
 *   tier-based styling to each seat.
 */
function generateBanquet(
  availableKeys,
  seatTierMap = {},
  seatDisabilityMap = {},
) {
  const container = document.getElementById("banquet-seating");
  const layoutEl = document.createElement("div");
  layoutEl.className = "banquet-layout";

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numTables = 15;
  const seatsPerTable = 10;
  const radius = 80; // pixels from table center to the center of each seat

  for (let t = 1; t <= numTables; t++) {
    const tableLabel = `Table ${alphabet[t - 1]}`; // "Table A", "Table B", …
    const tableContainer = document.createElement("div");
    tableContainer.className = "table-container";

    // The round table element is a visual label only — it is not a selectable seat
    const table = document.createElement("div");
    table.className = "banquet-table";
    table.innerText = tableLabel;
    tableContainer.appendChild(table);

    // Place each seat around the table using polar-to-cartesian conversion.
    // Seats are spaced at equal angular intervals starting from the top (−90°).
    for (let s = 1; s <= seatsPerTable; s++) {
      const seatKey = `${tableLabel}#${s}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      // Banquet tables are inherently wheelchair-accessible — no icon needed
      const seat = createSeat(s, "seat table-seat", status, tier, false);

      const angleDeg = (s - 1) * (360 / seatsPerTable) - 90;
      const angleRad = angleDeg * (Math.PI / 180);
      const x = Math.cos(angleRad) * radius;
      const y = Math.sin(angleRad) * radius;

      // Offset by half the seat's width (14px) to center it on the calculated point
      seat.style.left = `calc(50% - 14px + ${x}px)`;
      seat.style.top = `calc(50% - 14px + ${y}px)`;

      tableContainer.appendChild(seat);
    }

    layoutEl.appendChild(tableContainer);
  }

  container.appendChild(layoutEl);
}

/**
 * Generates the Bonnie Auditorium "All Section" layout into the
 * #bonnie-seating mount point.
 *
 * Structure
 * ---------
 *   200 fixed seats arranged as 10 rows (A–J) × 20 seats per row, where each
 *   row is split into three groups separated by aisle gaps:
 *
 *      [Row X]  [ 1  2  3  4  5 ]  ‹aisle›  [ 6 .. 15 ]  ‹aisle›  [16 17 18 19 20]
 *                  left (5)                center (10)              right (5)
 *
 *   Seat numbering is contiguous left → right within a row so the seat_key
 *   format ("{row}#{seatNum}", e.g. "A#1" .. "J#20") matches what the
 *   team03-create-tickets backend writes for ("Bonnie Auditorium", "All Section").
 *
 * Inputs
 * ------
 *   The function is intentionally a pure renderer: it does not fetch anything
 *   itself. The caller (the layout dispatch in renderVenue) is responsible for
 *   passing in the maps derived from the tickets API response so that seats
 *   render with the correct availability, pricing tier, and accessibility flag.
 *
 * @param {Set<string>|null} availableKeys
 *   Set of seat_key strings (e.g. "A#1") that are currently AVAILABLE for sale.
 *   Pass `null` to render every seat as available — used for previews and for
 *   the catch-all path when an event has no specific layout configured.
 * @param {Object<string, string>} [seatTierMap={}]
 *   Map of seat_key → tier name ("VIP" | "Standard" | "Budget"). Drives the
 *   tier-color CSS class applied to each seat. Missing keys default to
 *   "Standard" so the renderer never crashes on partial data.
 * @param {Object<string, boolean>} [seatDisabilityMap={}]
 *   Map of seat_key → true for ADA / accessible seats. Missing keys are treated
 *   as non-accessible.
 * @returns {void} Mutates the DOM by appending rows into #bonnie-seating.
 */
function generateBonnie(
  availableKeys,
  seatTierMap = {},
  seatDisabilityMap = {},
) {
  const container = document.getElementById("bonnie-seating");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (let r = 0; r < 10; r++) {
    const rowLabel = alphabet[r]; // 'A', 'B', … 'J'
    const rowEl = document.createElement("div");
    rowEl.className = "seating-row";

    // Row identifier label shown to the left
    const label = document.createElement("div");
    label.className = "row-label";
    label.innerText = `Row ${rowLabel}`;
    rowEl.appendChild(label);

    // Left seat group: 5 seats
    const leftGroup = document.createElement("div");
    leftGroup.className = "seat-group";
    leftGroup.style.width = 5 * 40 + "px";
    for (let s = 1; s <= 5; s++) {
      const seatKey = `${rowLabel}#${s}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      const isDisability = seatDisabilityMap[seatKey] || false;
      leftGroup.appendChild(
        createSeat(
          s,
          "seat seat-grid-item classroom-seat",
          status,
          tier,
          isDisability,
        ),
      );
    }

    // Visual aisle gap
    const leftGap = document.createElement("div");
    leftGap.className = "seat-gap";

    // Center seat group: 10 seats
    const centerGroup = document.createElement("div");
    centerGroup.className = "seat-group";
    centerGroup.style.width = 10 * 40 + "px";
    for (let s = 1; s <= 10; s++) {
      const seatNum = s + 5; // Continue numbering from left group
      const seatKey = `${rowLabel}#${seatNum}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      const isDisability = seatDisabilityMap[seatKey] || false;
      centerGroup.appendChild(
        createSeat(
          seatNum,
          "seat seat-grid-item classroom-seat",
          status,
          tier,
          isDisability,
        ),
      );
    }

    // Visual aisle gap
    const rightGap = document.createElement("div");
    rightGap.className = "seat-gap";

    // Right seat group: 5 seats
    const rightGroup = document.createElement("div");
    rightGroup.className = "seat-group";
    rightGroup.style.width = 5 * 40 + "px";
    for (let s = 1; s <= 5; s++) {
      const seatNum = s + 15; // Continue numbering from center group
      const seatKey = `${rowLabel}#${seatNum}`;
      const status = availableKeys
        ? availableKeys.has(seatKey)
          ? "AVAILABLE"
          : "SOLD"
        : "AVAILABLE";
      const tier = seatTierMap[seatKey] || "Standard";
      const isDisability = seatDisabilityMap[seatKey] || false;
      rightGroup.appendChild(
        createSeat(
          seatNum,
          "seat seat-grid-item classroom-seat",
          status,
          tier,
          isDisability,
        ),
      );
    }

    rowEl.appendChild(leftGroup);
    rowEl.appendChild(leftGap);
    rowEl.appendChild(centerGroup);
    rowEl.appendChild(rightGap);
    rowEl.appendChild(rightGroup);
    container.appendChild(rowEl);
  }
}

/* =============================================================
   LAYOUT GENERATOR — DEDMON CENTER (General Admission)
   16 sections (A–P) arranged clockwise around a central court.
   Each section card shows capacity + availability. Click a card to
   open the shared section editor panel with steppers for regular
   and (if present) ADA ticket quantities.
   ============================================================= */

/**
 * Generates the Dedmon Center GA layout — 16 sections arranged around
 * a central basketball court. Each section is rendered as a card.
 *
 * @param {Set<string>|null} availableKeys - Unused (kept for API parity;
 *   we use allAvailableTickets instead for per-section filtering).
 * @param {Object} seatTierMap - Map of seat_key → tier name.
 * @param {Object} seatDisabilityMap - Map of seat_key → disability boolean.
 */
function generateDedmon(availableKeys, seatTierMap, seatDisabilityMap) {
  const container = document.getElementById("dedmon-seating");
  if (!container) return;

  // Clear any prior render so re-invocations (e.g. after a cart refresh)
  // don't double-up the sections or the court graphic.
  container.innerHTML = "";

  // Render the court as a real grid child rather than a pseudo-element. This
  // eliminates the overlap risk when row heights collapse on smaller viewports
  // and lets us reflow the whole layout via grid rules alone.
  const court = document.createElement("div");
  court.className = "dedmon-court";
  court.setAttribute("aria-hidden", "true");
  court.innerHTML = `<span class="dedmon-court-label">BASKETBALL COURT</span>`;
  container.appendChild(court);

  const sectionOrder = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
  ];

  sectionOrder.forEach((sectionLetter) => {
    const sectionTickets = allAvailableTickets.filter(
      (t) => t.section === sectionLetter,
    );
    const availableTickets = sectionTickets.filter(
      (t) => t.status === "AVAILABLE",
    );
    const disabilityTickets = availableTickets.filter(
      (t) => t.disability === true,
    );

    console.log(
      `Section ${sectionLetter}: ${sectionTickets.length} total, ${availableTickets.length} available`,
    );

    const tier =
      sectionTickets.length > 0
        ? sectionTickets[0].tier || "Standard"
        : "Standard";
    const capacity = DEDMON_SECTIONS[sectionLetter]?.capacity || 100;
    const availableCount = availableTickets.length;
    const disabilityCount = disabilityTickets.length;

    const card = document.createElement("div");
    card.className = "dedmon-section-card";
    card.dataset.section = sectionLetter;
    card.dataset.tier = tier.toLowerCase();
    card.dataset.tierName = tier;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute(
      "aria-label",
      `Section ${sectionLetter}, ${tier} tier, ${availableCount} of ${capacity} available${
        disabilityCount > 0 ? `, ${disabilityCount} ADA` : ""
      }`,
    );
    card.setAttribute("aria-pressed", "false");

    if (availableCount === 0) {
      card.classList.add("unavailable");
      card.setAttribute("aria-disabled", "true");
    }

    const header = document.createElement("div");
    header.className = "section-header";
    header.dataset.tier = tier.toLowerCase();
    header.innerHTML = `<div class="section-label">${sectionLetter}</div>`;
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "section-body";
    body.innerHTML = `
      <div class="section-capacity">${capacity} seats</div>
      <div class="section-available">${availableCount} available</div>
      ${disabilityCount > 0 ? `<div class="section-disability">${disabilityCount} accessible</div>` : ""}
    `;
    card.appendChild(body);

    const badge = document.createElement("div");
    badge.className = "section-badge";
    badge.hidden = true;
    card.appendChild(badge);

    const handleCardActivate = () => {
      if (card.classList.contains("unavailable")) return;
      handleGASectionClick(sectionLetter, availableCount, disabilityCount);
    };
    card.addEventListener("click", handleCardActivate);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleCardActivate();
      }
    });

    container.appendChild(card);
  });

  ensureDedmonEditor();
}

/* =============================================================
   LAYOUT GENERATOR — GRADUATION (Dedmon Center)
   Reuses the Dedmon 7-column grid (.dedmon-court-grid) and card
   component (.dedmon-section-card) with four overrides applied at
   render time:
     1. The central court is replaced by an interactive "Student
        Section" card (spans cols 2–7, rows 2–4). Rules:
          • Only users with an @radford.edu email may select it.
          • Maximum 1 ticket per user, ever (backend-enforced via
            the SOLD ticket lookup in checkStudentsSectionOwnership).
          • Free (tier === "Budget", backend forces price $0).
          • No ADA assignment.
     2. Sections in GRADUATION_HIDDEN_SECTIONS (I–M, row 5) are not
        rendered at all — those cells host the Graduation Stage
        banner instead.
     3. Sections in GRADUATION_FORCED_UNAVAILABLE render in the
        legend's Unavailable grey (not tier-tinted) and are
        non-interactive regardless of ticket availability.
     4. GRADUATION_TIER_OVERRIDES take precedence over the
        backend-reported tier for the sections they name.
   ============================================================= */

/**
 * True if the given email is eligible for Student Section tickets.
 * Gate: case-insensitive suffix match on "@radford.edu". The email is
 * read from localStorage (set by the React app on login).
 *
 * @param {string|null|undefined} email
 * @returns {boolean}
 */
function isRadfordEmail(email) {
  if (!email || typeof email !== "string") return false;
  return email.trim().toLowerCase().endsWith("@radford.edu");
}

/**
 * Checks Team03's my-tickets endpoint to see if the logged-in user has
 * already purchased a Student Section ticket for the current event. Result
 * is cached in module-level `studentsSectionAlreadyOwned` so
 * generateGraduation() can render the card in a disabled state.
 *
 * Failure is silent — on network error we fall back to "not owned" so the
 * UI stays usable. The backend still enforces the real cap at purchase
 * time via the ticket status check.
 *
 * @param {string} eventId - Current event id (from the URL).
 * @returns {Promise<void>}
 */
async function checkStudentsSectionOwnership(eventId) {
  studentsSectionAlreadyOwned = false;
  const ownerSub = localStorage.getItem("userSub");
  if (!ownerSub || !eventId) return;
  try {
    const url = `https://service.example.invalid/production/Group-3/tickets/my-tickets?owner_id=${encodeURIComponent(ownerSub)}`;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    let data = text ? JSON.parse(text) : {};
    if (
      data &&
      typeof data.body === "string" &&
      typeof data.statusCode === "number"
    ) {
      data = JSON.parse(data.body);
    }
    const tickets = Array.isArray(data?.tickets)
      ? data.tickets
      : Array.isArray(data)
        ? data
        : [];
    studentsSectionAlreadyOwned = tickets.some(
      (t) => t.event_id === eventId && t.section === "Students Section",
    );
  } catch (err) {
    console.warn("Student Section ownership check failed:", err.message);
  }
}

/**
 * Renders the central "Student Section" card inside the Graduation grid.
 * Interactive — reuses the shared GA selection/editor/cart machinery via
 * handleGASectionClick — but carries three extra gates enforced both here
 * and in the editor:
 *   1. developer@example.com users → disabled with "Radford email required".
 *   2. User already owns one → disabled with "Already purchased".
 *   3. No available tickets → disabled with "Sold out".
 * The card spans the same grid slot as the Dedmon basketball court
 * (cols 2–7, rows 2–4) so the Graduation layout visually replaces the
 * court with an interactive centerpiece.
 *
 * @param {HTMLElement} container - The graduation-seating grid element.
 */
function renderStudentSectionCard(container) {
  const sectionId = "Students Section";
  const sectionTickets = allAvailableTickets.filter(
    (t) => t.section === sectionId,
  );
  const availableTickets = sectionTickets.filter(
    (t) => t.status === "AVAILABLE",
  );
  const availableCount = availableTickets.length;
  const capacity = 1500;
  const tier = "Budget";

  const userEmail = localStorage.getItem("userEmail");
  const isEligible = isRadfordEmail(userEmail);

  let disabledReason = null;
  if (!isEligible) disabledReason = "Radford email required";
  else if (studentsSectionAlreadyOwned) disabledReason = "Already purchased";
  else if (availableCount === 0) disabledReason = "Sold out";

  const card = document.createElement("div");
  card.className = "dedmon-section-card grad-students-card";
  card.dataset.section = sectionId;
  card.dataset.tier = tier.toLowerCase();
  card.dataset.tierName = tier;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute(
    "aria-label",
    `Student Section, free, ${availableCount} of ${capacity} available${
      disabledReason ? ` — ${disabledReason}` : ""
    }`,
  );
  card.setAttribute("aria-pressed", "false");

  if (disabledReason) {
    card.classList.add("unavailable");
    card.setAttribute("aria-disabled", "true");
    card.title = disabledReason;
  }

  const header = document.createElement("div");
  header.className = "section-header";
  header.innerHTML = `<div class="section-label">STUDENT SECTION</div>`;
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "section-body";
  // Match the perimeter section cards: seat count + currently available.
  // Student Section has no ADA tickets by design, so the accessible line
  // is omitted. When the card is gated shut (e.g. "Already purchased"),
  // surface that reason in place of the available line so the state is
  // legible at a glance.
  body.innerHTML = `
    <div class="section-capacity">${capacity} seats</div>
    <div class="section-available">${disabledReason ? disabledReason : `${availableCount} available`}</div>
  `;
  card.appendChild(body);

  const badge = document.createElement("div");
  badge.className = "section-badge";
  badge.hidden = true;
  card.appendChild(badge);

  // ADA count is intentionally zero — backend does not assign ADA seats to
  // the Student Section and the per-user cap is 1 regardless.
  const handleCardActivate = () => {
    if (card.classList.contains("unavailable")) return;
    handleGASectionClick(sectionId, availableCount, 0);
  };
  card.addEventListener("click", handleCardActivate);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardActivate();
    }
  });

  container.appendChild(card);
}

/**
 * Renders the non-interactive "GRADUATION STAGE" banner that replaces
 * sections I–M in the bottom row of the grid.
 *
 * @param {HTMLElement} container - The graduation-seating grid element.
 */
function renderGraduationStage(container) {
  const stage = document.createElement("div");
  stage.className = "grad-stage";
  stage.setAttribute("aria-hidden", "true");
  stage.innerHTML = `<span class="grad-stage-label">GRADUATION STAGE</span>`;
  container.appendChild(stage);
}

/**
 * Generates the Graduation layout for Dedmon Center.
 *
 * @param {Set<string>|null} availableKeys - Unused (per-section filter via allAvailableTickets).
 * @param {Object} seatTierMap - Map of seat_key → tier name.
 * @param {Object} seatDisabilityMap - Map of seat_key → disability boolean.
 */
function generateGraduation(availableKeys, seatTierMap, seatDisabilityMap) {
  const container = document.getElementById("graduation-seating");
  if (!container) return;

  // Clear any prior render so re-invocations (e.g. after a cart refresh)
  // don't double-up the sections or the court graphic.
  container.innerHTML = "";

  renderStudentSectionCard(container);
  renderGraduationStage(container);

  const sectionOrder = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
  ];

  sectionOrder.forEach((sectionLetter) => {
    if (GRADUATION_HIDDEN_SECTIONS.has(sectionLetter)) return;
    const sectionTickets = allAvailableTickets.filter(
      (t) => t.section === sectionLetter,
    );
    const availableTickets = sectionTickets.filter(
      (t) => t.status === "AVAILABLE",
    );
    const disabilityTickets = availableTickets.filter(
      (t) => t.disability === true,
    );

    // Tier precedence: explicit Graduation override → backend tier →
    // "Standard" default. Overrides win even when the backend disagrees
    // because the Graduation layout intentionally repositions tiers
    // (A/B/C standard, D/E VIP) regardless of ticket metadata.
    const backendTier =
      sectionTickets.length > 0 ? sectionTickets[0].tier : null;
    const tier =
      GRADUATION_TIER_OVERRIDES[sectionLetter] || backendTier || "Standard";
    const capacity = DEDMON_SECTIONS[sectionLetter]?.capacity || 100;
    const availableCount = availableTickets.length;
    const disabilityCount = disabilityTickets.length;
    const isForcedUnavailable =
      GRADUATION_FORCED_UNAVAILABLE.has(sectionLetter);

    const card = document.createElement("div");
    card.className = "dedmon-section-card";
    card.dataset.section = sectionLetter;
    card.dataset.tier = tier.toLowerCase();
    card.dataset.tierName = tier;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute(
      "aria-label",
      `Section ${sectionLetter}, ${tier} tier, ${availableCount} of ${capacity} available${
        disabilityCount > 0 ? `, ${disabilityCount} ADA` : ""
      }${isForcedUnavailable ? " — Unavailable" : ""}`,
    );
    card.setAttribute("aria-pressed", "false");

    // Graduation forces a specific subset of sections into the legend's
    // Unavailable grey. The .grad-forced-unavailable modifier overrides
    // the tier-tinted background/border with --seat-unavailable so the
    // card matches the Unavailable swatch in the legend exactly.
    if (isForcedUnavailable) {
      card.classList.add("unavailable", "grad-forced-unavailable");
      card.setAttribute("aria-disabled", "true");
    } else if (availableCount === 0) {
      card.classList.add("unavailable");
      card.setAttribute("aria-disabled", "true");
    }

    const header = document.createElement("div");
    header.className = "section-header";
    header.dataset.tier = tier.toLowerCase();
    header.innerHTML = `<div class="section-label">${sectionLetter}</div>`;
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "section-body";
    // Forced-unavailable cards show a simple "Unavailable" line instead of
    // "N available" so the UI reflects the legend's status category.
    body.innerHTML = `
      <div class="section-capacity">${capacity} seats</div>
      <div class="section-available">${isForcedUnavailable ? "Unavailable" : `${availableCount} available`}</div>
      ${!isForcedUnavailable && disabilityCount > 0 ? `<div class="section-disability">${disabilityCount} accessible</div>` : ""}
    `;
    card.appendChild(body);

    const badge = document.createElement("div");
    badge.className = "section-badge";
    badge.hidden = true;
    card.appendChild(badge);

    const handleCardActivate = () => {
      if (card.classList.contains("unavailable")) return;
      handleGASectionClick(sectionLetter, availableCount, disabilityCount);
    };
    card.addEventListener("click", handleCardActivate);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleCardActivate();
      }
    });

    container.appendChild(card);
  });

  ensureDedmonEditor();
}

/**
 * Creates (once) the shared Dedmon section editor panel.
 * @returns {HTMLElement} the editor panel element.
 */
function ensureDedmonEditor() {
  let panel = document.getElementById("dedmon-section-editor");
  // The editor is a singleton but its host differs per GA layout. If the panel
  // already exists but was mounted under the wrong host (e.g. user switched
  // events), detach it so the insertBefore below re-anchors it correctly.
  const hostId = isGraduation ? "graduation" : "dedmon";
  const host = document.getElementById(hostId);
  if (!host) return panel || null;
  if (panel && panel.parentElement !== host) (panel.remove(), (panel = null));
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "dedmon-section-editor";
  panel.className = "dedmon-section-editor";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("aria-label", "Selected section ticket controls");
  panel.innerHTML = `
    <div class="editor-header">
      <div class="editor-title">
        <span class="editor-section-pill"></span>
        <span class="editor-tier-pill"></span>
        <span class="editor-price"></span>
      </div>
      <button type="button" class="editor-close" aria-label="Close section controls">×</button>
    </div>
    <div class="editor-rows"></div>
    <div class="editor-footer">
      <span class="editor-subtotal-label">Section subtotal</span>
      <span class="editor-subtotal-value">$0.00</span>
    </div>
  `;

  const scrollWrap = host.querySelector(".dedmon-scroll-wrap");
  const anchor = scrollWrap || host.querySelector(".dedmon-court-grid");
  host.insertBefore(panel, anchor || host.firstChild);

  panel.querySelector(".editor-close").addEventListener("click", () => {
    if (activeGASection)
      handleGASectionClick(activeGASection, 0, 0, { forceClose: true });
  });

  return panel;
}

/**
 * Handles when user clicks a GA section card.
 */
function handleGASectionClick(
  sectionLetter,
  availableCount,
  disabilityCount,
  { forceClose = false } = {},
) {
  const panel = ensureDedmonEditor();
  if (!panel) return;

  const card = document.querySelector(
    `.dedmon-section-card[data-section="${sectionLetter}"]`,
  );

  if (forceClose || activeGASection === sectionLetter) {
    panel.hidden = true;
    card?.setAttribute("aria-pressed", "false");
    card?.classList.remove("is-active");
    activeGASection = null;
    return;
  }

  if (activeGASection) {
    const prev = document.querySelector(
      `.dedmon-section-card[data-section="${activeGASection}"]`,
    );
    prev?.setAttribute("aria-pressed", "false");
    prev?.classList.remove("is-active");
  }

  if (!selectedGASections[sectionLetter]) {
    selectedGASections[sectionLetter] = {
      section: sectionLetter,
      quantity: 0,
      disabilityQuantity: 0,
      tier: card?.dataset.tierName || "Standard",
      savedRegularKeys: [],
      savedDisabilityKeys: [],
    };
  }

  activeGASection = sectionLetter;
  card?.setAttribute("aria-pressed", "true");
  card?.classList.add("is-active");

  renderDedmonEditor(sectionLetter, availableCount, disabilityCount);
  panel.hidden = false;

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Populates the shared Dedmon editor panel for the given section.
 */
function renderDedmonEditor(sectionLetter, availableCount, disabilityCount) {
  const panel = document.getElementById("dedmon-section-editor");
  if (!panel) return;
  const state = selectedGASections[sectionLetter];
  if (!state) return;

  const tier = state.tier || "Standard";
  const tierClass = tier.toLowerCase();
  const tierPrice = tierPrices[tier];
  const priceLabel =
    typeof tierPrice === "number" && tierPrice > 0
      ? `$${tierPrice.toFixed(2)} per ticket`
      : "";

  panel.dataset.section = sectionLetter;
  panel.dataset.tier = tierClass;

  // Student Section in the Graduation layout gets a bespoke title ("Student
  // Section") instead of the generic "Section X" to avoid the redundant
  // "Section Students Section" phrasing.
  const isStudents = isGraduation && sectionLetter === "Students Section";
  panel.querySelector(".editor-section-pill").textContent = isStudents
    ? "Student Section"
    : `Section ${sectionLetter}`;

  // The Student Section is always Budget tier + free, so the "BUDGET" pill
  // is visual noise — hide it for that case only.
  const tierPill = panel.querySelector(".editor-tier-pill");
  if (isStudents) {
    tierPill.hidden = true;
    tierPill.textContent = "";
  } else {
    tierPill.hidden = false;
    tierPill.textContent = tier;
    tierPill.dataset.tier = tierClass;
  }
  panel.querySelector(".editor-price").textContent = priceLabel;

  // Student Section caps the regular stepper at 1 per user and never
  // offers ADA (backend does not assign disability seats there).
  const rawMaxRegular = availableCount + (state.savedRegularKeys?.length || 0);
  const maxRegular = isStudents ? Math.min(1, rawMaxRegular) : rawMaxRegular;
  const maxDisability = isStudents
    ? 0
    : disabilityCount + (state.savedDisabilityKeys?.length || 0);

  const rows = panel.querySelector(".editor-rows");
  rows.innerHTML = `
    ${buildStepperRow({
      type: "regular",
      label: "Standard tickets",
      helper: `Up to ${maxRegular} available`,
      value: state.quantity,
      max: maxRegular,
    })}
    ${
      disabilityCount > 0 || (state.savedDisabilityKeys?.length || 0) > 0
        ? buildStepperRow({
            type: "disability",
            label: "Accessible tickets",
            helper: "Same price · ADA seating",
            value: state.disabilityQuantity,
            max: maxDisability,
          })
        : ""
    }
  `;

  rows.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      const isMinus = btn.classList.contains("qty-minus");
      const input = rows.querySelector(`.qty-${type}`);
      const maxFor = type === "regular" ? maxRegular : maxDisability;
      const currentVal = parseInt(input.value, 10) || 0;
      const newVal = isMinus
        ? Math.max(0, currentVal - 1)
        : Math.min(maxFor, currentVal + 1);
      input.value = newVal;
      updateGASelection(sectionLetter, type, newVal, maxFor);
      updateEditorSubtotal(sectionLetter);
    });
  });

  updateEditorSubtotal(sectionLetter);
}

/**
 * Inline template for a single − [input] + stepper row used inside the editor.
 */
function buildStepperRow({ type, label, helper, value, max }) {
  const idBase = `dedmon-qty-${type}`;
  return `
    <div class="editor-row" data-type="${type}">
      <div class="editor-row-labels">
        <label class="editor-row-label" for="${idBase}">${label}</label>
        <span class="editor-row-helper">${helper}</span>
      </div>
      <div class="editor-stepper">
        <button type="button" class="qty-btn qty-minus" data-type="${type}" aria-label="Decrease ${label.toLowerCase()}">−</button>
        <input id="${idBase}" type="number" class="qty-input qty-${type}" data-type="${type}" min="0" max="${max}" value="${value}" readonly aria-label="${label}" />
        <button type="button" class="qty-btn qty-plus" data-type="${type}" aria-label="Increase ${label.toLowerCase()}">+</button>
      </div>
    </div>
  `;
}

/**
 * Refreshes the subtotal shown in the editor footer for the active section.
 */
function updateEditorSubtotal(sectionLetter) {
  const panel = document.getElementById("dedmon-section-editor");
  if (!panel) return;
  const state = selectedGASections[sectionLetter];
  if (!state) return;
  const tierPrice = tierPrices[state.tier] || 0;
  const qty = (state.quantity || 0) + (state.disabilityQuantity || 0);
  const subtotal = qty * tierPrice;
  const valueEl = panel.querySelector(".editor-subtotal-value");
  if (valueEl) valueEl.textContent = `$${subtotal.toFixed(2)}`;
}

/**
 * Updates the GA selection state and refreshes the checkout UI.
 */
function updateGASelection(sectionLetter, type, newValue, maxAvailable) {
  if (!selectedGASections[sectionLetter]) {
    const card = document.querySelector(`[data-section="${sectionLetter}"]`);
    selectedGASections[sectionLetter] = {
      section: sectionLetter,
      quantity: 0,
      disabilityQuantity: 0,
      tier: card?.dataset.tierName || "Standard",
      savedRegularKeys: [],
      savedDisabilityKeys: [],
    };
  }

  if (type === "regular") {
    selectedGASections[sectionLetter].quantity = Math.min(
      Math.max(0, newValue),
      maxAvailable,
    );
  } else if (type === "disability") {
    selectedGASections[sectionLetter].disabilityQuantity = Math.min(
      Math.max(0, newValue),
      maxAvailable,
    );
  }

  updateGACheckoutUI();
}

/**
 * Rebuilds `selectedSeats` (seat_key → tier) from the per-section GA state.
 */
function rebuildGASelectedSeats() {
  const next = {};
  Object.values(selectedGASections).forEach((sel) => {
    const { section, quantity, disabilityQuantity, tier } = sel;
    const savedRegular = sel.savedRegularKeys || [];
    const savedDisability = sel.savedDisabilityKeys || [];

    const sectionAvail = allAvailableTickets.filter(
      (t) => t.section === section && t.status === "AVAILABLE",
    );
    const availRegular = sectionAvail
      .filter((t) => !t.disability)
      .map((t) => t.seat_key);
    const availDisability = sectionAvail
      .filter((t) => t.disability === true)
      .map((t) => t.seat_key);

    const regKept = savedRegular.slice(0, quantity);
    const regNew = availRegular
      .filter((k) => !regKept.includes(k))
      .slice(0, Math.max(0, quantity - regKept.length));

    const disKept = savedDisability.slice(0, disabilityQuantity);
    const disNew = availDisability
      .filter((k) => !disKept.includes(k))
      .slice(0, Math.max(0, disabilityQuantity - disKept.length));

    [...regKept, ...regNew, ...disKept, ...disNew].forEach((k) => {
      next[k] = tier;
    });
  });
  selectedSeats = next;
}

/**
 * Recalculates and updates the sticky checkout bar for GA selections.
 */
function updateGACheckoutUI() {
  rebuildGASelectedSeats();
  selectedTicketsCount = Object.keys(selectedSeats).length;
  updateGABadges();
  updateCheckoutUI();
}

/**
 * Reflects current per-section quantities on the section cards as a badge.
 */
function updateGABadges() {
  document.querySelectorAll(".dedmon-section-card").forEach((card) => {
    const section = card.dataset.section;
    const sel = selectedGASections[section];
    const total = sel ? (sel.quantity || 0) + (sel.disabilityQuantity || 0) : 0;
    const badge = card.querySelector(".section-badge");
    if (!badge) return;
    if (total > 0) {
      badge.hidden = false;
      badge.textContent =
        sel.disabilityQuantity > 0
          ? `${total} • ${sel.disabilityQuantity} accessible`
          : `${total} selected`;
      card.classList.add("has-selection");
    } else {
      badge.hidden = true;
      card.classList.remove("has-selection");
    }
  });
}

/**
 * Fetches Dedmon Center tickets one section at a time and merges the results.
 */
async function fetchDedmonTickets(eventId, sectionList) {
  // sectionList defaults to the Dedmon "All Section" set (A–P). The
  // Graduation layout passes A–P plus "Students Section" so the
  // centerpiece card has ticket data to read.
  const sectionLetters = sectionList || Object.keys(DEDMON_SECTIONS);
  const responses = await Promise.all(
    sectionLetters.map((letter) => fetchTickets(eventId, letter)),
  );

  const availableKeys = new Set();
  const seatTierMap = {};
  const seatDisabilityMap = {};
  const allTickets = [];

  responses.forEach((r) => {
    if (r.availableKeys) {
      r.availableKeys.forEach((k) => availableKeys.add(k));
    }
    Object.assign(seatTierMap, r.seatTierMap || {});
    Object.assign(seatDisabilityMap, r.seatDisabilityMap || {});
    if (Array.isArray(r.allTickets)) allTickets.push(...r.allTickets);
  });

  return { availableKeys, seatTierMap, seatDisabilityMap, allTickets };
}

/**
 * Restores Dedmon Center GA state from a previously saved cart item.
 */
function preselectDedmonSections(seatKeys, disabledSeatKeys) {
  const disabledSet = new Set(disabledSeatKeys || []);
  const bySection = {};

  seatKeys.forEach((key) => {
    const [section] = key.split("#");
    if (!section) return;
    if (!bySection[section])
      bySection[section] = { regular: [], disability: [] };
    if (disabledSet.has(key)) {
      bySection[section].disability.push(key);
    } else {
      bySection[section].regular.push(key);
    }
  });

  Object.entries(bySection).forEach(([section, groups]) => {
    const card = document.querySelector(
      `.dedmon-section-card[data-section="${section}"]`,
    );
    const tier = card?.dataset.tierName || "Standard";

    selectedGASections[section] = {
      section,
      quantity: groups.regular.length,
      disabilityQuantity: groups.disability.length,
      tier,
      savedRegularKeys: groups.regular,
      savedDisabilityKeys: groups.disability,
    };
  });

  updateGACheckoutUI();
  updateNavCartCount();
}

/* =============================================================
   API — PRICING
   Fetches available pricing tiers for an event from Team03.
   Returns a map of { tierName: price } (e.g. { Standard: 25 }).
   This app currently only uses the "Standard" tier.
   ============================================================= */

/**
 * Fetches pricing tier data for the given event from the Group-3 API.
 *
 * @param {string} eventId - The event's unique identifier.
 * @returns {Promise<Object>} A plain object mapping tier names to numeric prices,
 *   e.g. `{ Standard: 25, VIP: 50 }`. Returns an empty object on any error
 *   so callers can safely access properties without null-checks.
 */
async function fetchPricingTiers(eventId) {
  try {
    const url = `${API_BASE}/Group-3/pricing-tiers?event_id=${encodeURIComponent(eventId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(
        `Pricing API error: ${response.status} ${response.statusText}`,
      );
      return {};
    }

    const data = await response.json();
    // The API may return a bare array or a wrapper object — handle both shapes
    const tiers = Array.isArray(data) ? data : data.tiers || data.items || [];

    // Normalize to a { tierName: price } lookup map
    const priceMap = {};
    tiers.forEach((t) => {
      if (t.tier && t.price !== undefined) {
        priceMap[t.tier] = Number(t.price);
      }
    });

    console.log("Loaded pricing tiers:", priceMap);
    return priceMap;
  } catch (error) {
    console.warn("Failed to fetch pricing tiers:", error);
    return {};
  }
}

/* =============================================================
   API — DISCOUNTS
   Fetches active discount records for an event. A discount is
   considered "active" when its `discount` field is truthy.
   Active discounts override the base price from fetchPricingTiers.
   ============================================================= */

/**
 * Fetches active discount records for the given event from the Group-3 API.
 *
 * @param {string} eventId - The event's unique identifier.
 * @returns {Promise<Array>} Array of active discount objects. Each object is
 *   expected to have at minimum `{ tier: string, discount_price: number }`.
 *   Returns an empty array on any error so callers can iterate safely.
 */
async function fetchDiscounts(eventId) {
  try {
    const url = `${API_BASE}/Group-3/tickets/discounts?event_id=${encodeURIComponent(eventId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Discounts API: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    // Normalize: accept various wrapper shapes the API might return
    const items = Array.isArray(data)
      ? data
      : data.active_discounts ||
        data.tiers ||
        data.items ||
        data.discounts ||
        [];

    // Only keep records that are explicitly flagged as active
    const active = items.filter(
      (d) => d.discount === true || d.discount === "true",
    );
    console.log(
      `Loaded ${active.length} active discount(s) for event ${eventId}.`,
    );
    return active;
  } catch (error) {
    console.warn("Failed to fetch discounts:", error);
    return [];
  }
}

/* =============================================================
   API — TICKETS
   Fetches the set of currently available (unsold) seat keys for
   an event. The API returns one record per seat; this function
   filters out sold seats and metadata sentinels, returning a
   Set of key strings for O(1) availability lookups during render.

   Seat key format (agreed with Team03):
     Classroom / Theater: "<RowLetter>#<SeatNumber>"    e.g. "A#3"
     Banquet:             "Table <Letter>#<SeatNumber>" e.g. "Table B#7"
   ============================================================= */

/**
 * Fetches available seat keys and tier information for the given event from the Group-3 API.
 *
 * @param {string} eventId - The event's unique identifier.
 * @returns {Promise<Object>} Object containing:
 *   - availableKeys: Set<string> - Set of available seat key strings
 *   - seatTierMap: Object - Map of seat_key to tier name (e.g. {  "A#1": "VIP", "A#2": "Standard" })
 *   Returns {availableKeys: null, seatTierMap: {}} on error so callers can handle gracefully.
 */
async function fetchTickets(eventId, section = null) {
  try {
    const sectionQS = section ? `&section=${encodeURIComponent(section)}` : "";
    const url = `${API_BASE}/Group-3/tickets/available-tickets?event_id=${encodeURIComponent(eventId)}${sectionQS}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(
        `Tickets API error: ${response.status} ${response.statusText}`,
      );
      return {
        availableKeys: null,
        seatTierMap: {},
        seatDisabilityMap: {},
        allTickets: [],
      };
    }

    let data = await response.json();
    // Unwrap API Gateway Lambda envelope (same as apiFetch in ApiService.js).
    // Some routes return { statusCode, body } instead of the payload directly.
    if (
      data &&
      typeof data.body === "string" &&
      typeof data.statusCode === "number"
    ) {
      data = JSON.parse(data.body);
    }
    const tickets = Array.isArray(data)
      ? data
      : data.seats || data.tickets || data.items || [];

    // Build a Set for fast O(1) lookups and map seat keys to their tiers
    const availableKeys = new Set();
    const seatTierMap = {};
    const seatDisabilityMap = {};

    tickets.forEach((t) => {
      // Filter out metadata sentinel records (not real purchasable seats)
      if (
        t.ticket_id !== "METADATA" &&
        t.seat_key &&
        (!t.event_id || t.event_id === eventId)
      ) {
        // Only AVAILABLE tickets can be selected — HELD, SOLD, and USED show as grey
        if (t.status === "AVAILABLE") {
          availableKeys.add(t.seat_key);
        }
        // Store tier for all seats so pricing is correct even for unavailable ones
        seatTierMap[t.seat_key] = t.tier || "Standard";
        // Store disability status for all seats
        seatDisabilityMap[t.seat_key] = t.disability || false;
      }
    });

    console.log(
      `Loaded ${availableKeys.size} available seats with tier data for event ${eventId}${section ? ` (section ${section})` : ""}.`,
    );
    return {
      availableKeys,
      seatTierMap,
      seatDisabilityMap,
      allTickets: tickets,
    };
  } catch (error) {
    console.warn("Failed to fetch ticket data:", error);
    return {
      availableKeys: null,
      seatTierMap: {},
      seatDisabilityMap: {},
      allTickets: [],
    };
  }
}

/* =============================================================
   API — EVENTS
   Fetches event metadata (name, date, venue, layout) from the
   Group-2 API. Two URL strategies are tried before giving up:
     1. Direct path:   GET /Group-2/events/:id
     2. Query-param:   GET /Group-2/events?event_id=:id  (403 fallback)
   A name-based search is also available as a last resort when
   the event_id alone is not enough to retrieve the record.
   ============================================================= */

/**
 * Reads a single query parameter from the current page URL.
 *
 * @param {string} paramName - The name of the URL query parameter to read.
 * @returns {string|null} The decoded parameter value, or null if absent.
 *
 * @example
 *   // URL: venue.html?event_id=abc123
 *   getQueryParam('event_id'); // → 'abc123'
 */
function getQueryParam(paramName) {
  return new URLSearchParams(window.location.search).get(paramName);
}

/**
 * Fetches full metadata for a single event from the Group-2 API.
 *
 * Calls `GET /Group-2/:id` — the correct Team02 endpoint for fetching a
 * single event by its unique ID. If the request fails, returns null so the
 * caller can fall back to the name-search strategy already in the init flow.
 *
 * @param {string} eventId - The event's unique identifier.
 * @returns {Promise<Object|null>} The event metadata object, or null if the
 *   request fails. The caller should handle null gracefully.
 */
async function fetchEventById(eventId) {
  try {
    const url = `${API_BASE}/Group-2/${encodeURIComponent(eventId)}`;
    const response = await fetch(url);

    if (response.ok) {
      return await response.json();
    }

    console.warn(`Event API error: ${response.status} ${response.statusText}`);
    return null;
  } catch (error) {
    console.warn("Failed to fetch event by ID:", error);
    return null;
  }
}

/**
 * Searches for an event by name using the Group-2 search endpoint.
 * Used as a last-resort fallback when fetchEventById fails and the URL
 * contains an `event_name` parameter to search with.
 *
 * @param {string} eventName - The event name string to search for.
 * @returns {Promise<Object|null>} The first matching event object, or null if
 *   no results are returned or the request fails.
 */
async function searchEventByName(eventName) {
  try {
    const url = `${API_BASE}/Group-2/events?q=${encodeURIComponent(eventName)}&limit=1`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(
        `Search API error: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();
    if (data.items && data.items.length > 0) {
      return data.items[0];
    }

    console.warn(`No event found for: "${eventName}"`);
    return null;
  } catch (error) {
    console.warn("Failed to search event by name:", error);
    return null;
  }
}

/* =============================================================
   UI — ERROR STATE
   Shown when no event_id is in the URL, or when all API
   strategies have been exhausted and no event data is available.
   Replaces the seat map with a friendly message and hides UI
   elements that would be confusing without a valid event.
   ============================================================= */

/**
 * Replaces the seat map area with a user-friendly error message and hides
 * the checkout bar and layout selector so the page doesn't appear broken.
 *
 * @param {string} [message] - Custom error text to display to the user.
 *   Defaults to a generic "No event specified" message.
 */
/**
 * Fade out and remove the full-screen loading overlay rendered by venue.html.
 *
 * The overlay (#venue-loader) is painted on first frame via inline styles in
 * <head>, so users never see the placeholder seat-map stages or the blank
 * event title while we fetch data. Once the initial render completes — or an
 * error path takes over — we call this to reveal the page.
 *
 * Safe to call more than once; subsequent calls are no-ops because the node
 * is removed after the fade transition.
 *
 * @returns {void}
 */
function hideVenueLoader() {
  const loader = document.getElementById("venue-loader");
  if (!loader) return;
  loader.classList.add("hidden");
  // Wait for the opacity transition to finish before removing from the DOM
  // so screen readers stop announcing the live-region text at the same time
  // the visual fade completes.
  setTimeout(() => loader.remove(), 300);
}

function showNoEventError(
  message = "No event specified. Please open this page from a valid event link.",
) {
  // Hide loader so the error message isn't covered by the loading overlay.
  hideVenueLoader();
  const wrapper = document.querySelector(".venue-interactive-wrapper");
  if (wrapper) {
    wrapper.innerHTML = `
            <div style="text-align:center; padding: 60px 20px; color: #64748b;">
                <p style="font-size: 1.25rem; font-weight: 600; margin-bottom: 8px;">Unable to load seat map</p>
                <p style="font-size: 0.95rem;">${message}</p>
            </div>`;
  }

  const checkoutBar = document.querySelector(".sticky-checkout-bar");
  if (checkoutBar) checkoutBar.style.display = "none";

  const layoutSelector = document.querySelector(".layout-selector");
  if (layoutSelector) layoutSelector.style.display = "none";
}

/**
 * Updates the page heading and subtitle with live event details.
 * Safe to call with null — shows "Event details unavailable" as a fallback.
 *
 * @param {Object|null} eventData - Event metadata from the Group-2 API.
 *   Reads: `event_name`, `date_time`, `location`.
 */
function updateEventHeader(eventData) {
  const titleEl = document.querySelector(".section-title");
  const subtitleEl = document.querySelector(".venue-subtitle");

  if (!eventData) {
    if (subtitleEl) subtitleEl.innerText = "Event details unavailable";
    return;
  }

  if (titleEl && eventData.event_name) {
    titleEl.innerText = eventData.event_name;
  }

  if (subtitleEl) {
    let subtitle = "";

    if (eventData.date_time) {
      const eventDate = new Date(eventData.date_time);
      const dateStr = eventDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const timeStr = eventDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      subtitle += `📅 ${dateStr} • 🕐 ${timeStr}`;
    }

    if (eventData.venue_name || eventData.location) {
      subtitle += ` • 📍 ${eventData.venue_name || eventData.location}`;
    }

    subtitleEl.innerText = subtitle || "Event details unavailable";
  }
}

/* =============================================================
   LAYOUT VISIBILITY
   When an event has a specific venue+layout configuration (e.g.
   "Muse Banquet Hall-Theater"), only that layout tab should be
   accessible and all others should be disabled. showOnlyLayout()
   locks the UI to the correct layout for the event.

   VENUE_STYLE_MAP maps a "VenueName-LayoutName" key to the HTML
   container id and the matching tab button label text.
   Add new entries here as additional venue configurations come online.
   ============================================================= */

/**
 * Maps a combined "VenueName-LayoutName" key to the HTML container id
 * and the corresponding tab button label text.
 *
 * @type {Object.<string, {id: string, label: string}>}
 */
const VENUE_STYLE_MAP = {
  "Muse Banquet Hall-Classroom": { id: "classroom", label: "Classroom Style" },
  "Muse Banquet Hall-Theater": { id: "theater", label: "Theater Style" },
  "Muse Banquet Hall-Banquet": { id: "banquet", label: "Banquet Style" },
  // Bonnie Auditorium has a single fixed layout. The key string MUST match
  // exactly what the backend writes — see SEATING_LAYOUTS in
  // team03-create-tickets — otherwise lockLayoutSelector will fail to find
  // the matching tab and the user will see the unfiltered fallback view.
  "Bonnie Auditorium-All Section": { id: "bonnie", label: "All Section" },
  // Dedmon Center — General Admission (GA) sections model
  "Dedmon Center-All Section": { id: "dedmon", label: "All Section" },
  // Dedmon Center — Graduation ceremony layout (6 GA sections + free students pit)
  "Dedmon Center-Graduation": { id: "graduation", label: "Graduation" },
};

/**
 * Locks the layout selector to the single layout configured for this event.
 * Disables and dims all other layout buttons to prevent switching to a layout
 * that doesn't match the event's venue setup.
 *
 * If the combined "venueName-layoutName" key is not in VENUE_STYLE_MAP,
 * the function exits without making any changes (all layouts remain accessible).
 *
 * @param {string} venueName  - Venue name from event metadata (e.g. "Muse Banquet Hall").
 * @param {string} layoutName - Layout name from event metadata (e.g. "Theater").
 */
function showOnlyLayout(venueName, layoutName) {
  const key = `${venueName}-${layoutName}`;
  const config = VENUE_STYLE_MAP[key];
  if (!config) return;

  document.querySelectorAll(".layout-selector button").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.innerText.trim() === config.label) {
      btn.classList.add("active");
    } else {
      // Grey out tabs that don't apply to this event's venue
      btn.disabled = true;
      btn.style.opacity = "0.4";
      btn.style.cursor = "not-allowed";
    }
  });

  document
    .querySelectorAll(".venue-container")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(config.id).classList.add("active");

  // Banquet tables are inherently wheelchair-accessible — hide the legend item
  const accessibleLegend = document.getElementById("legend-accessible");
  if (accessibleLegend && config.id === "banquet")
    accessibleLegend.style.display = "none";

  // The Graduation layout has no Budget-tier selectable seating — the
  // Student Section is free and rendered as a single centerpiece without
  // a Budget pill — so the Budget legend swatch would be misleading.
  if (config.id === "graduation") {
    document.querySelectorAll(".legend-item").forEach((el) => {
      if (el.textContent.trim().toLowerCase().startsWith("budget")) {
        el.style.display = "none";
      }
    });
  }
}

/* =============================================================
   CART — RESTORE STATE
   Helpers for restoring a previously-saved seat selection when
   the user returns to the venue page from /cart. The actual
   "Add to Cart" handler lives further down in the file.
   ============================================================= */

/**
 * Pre-selects seats that are already stored in the cart for this event.
 * Called on page load so the seat map reflects the user's saved selection
 * if they navigate back to the venue page from index.html.
 *
 * Handles three formats:
 *   - String: "Row F-4" or "Table A-4" (legacy)
 *   - Object: { label: "Row F-4", tier: "VIP" } (legacy object format)
 *   - String: "Row F-4 (VIP)" or "Table A-4 (Standard)" (display format)
 *
 * @param {Array} seats - Array of seat entries from the
 *   `seats` field of the matching cart item in localStorage.
 * @param {Array} disabledSeats - Array of seat keys that are disability-accessible (fallback for held seats).
 */
function preselectSeats(seats, disabledSeats = []) {
  const savedDisabledSeats = new Set(disabledSeats || []);

  // Merge saved disability seats back into the global map so handleAddToCart can find them later
  disabledSeats.forEach((key) => {
    seatDisabilityMap[key] = true;
  });

  seats.forEach((seatEntry) => {
    // Handle multiple formats for backward compatibility
    let label = "";
    let tier = "Standard";

    // Format 1: String with tier in parentheses: "Row F-4 (VIP)" or "Row F-4 (VIP, disability)"
    if (typeof seatEntry === "string" && seatEntry.includes("(")) {
      const match = seatEntry.match(/^(.+?)\s\((.+)\)$/);
      if (match) {
        label = match[1];
        // Extract just the tier (first part before comma if present)
        const tierPart = match[2].split(",")[0].trim();
        tier = tierPart || "Standard";
      } else {
        label = seatEntry; // Fallback to just the string
      }
    }
    // Format 2: Plain string: "Row F-4"
    else if (typeof seatEntry === "string") {
      label = seatEntry;
    }
    // Format 3: Object with label and tier
    else if (typeof seatEntry === "object") {
      label = seatEntry.label;
      tier = seatEntry.tier || "Standard";
    } else {
      return; // Skip invalid entries
    }

    // Classroom / Theater: "Row F-4" → row letter "F", seat innerText "4"
    const rowMatch = label.match(/^Row ([A-Z])-(\d+)$/);
    if (rowMatch) {
      const [, rowLetter, seatNum] = rowMatch;
      document.querySelectorAll(".seating-row").forEach((row) => {
        const labelEl = row.querySelector(".row-label");
        if (labelEl && labelEl.innerText.trim() === `Row ${rowLetter}`) {
          row.querySelectorAll(".seat").forEach((seat) => {
            if (seat.innerText.trim() === seatNum) {
              seat.classList.remove("unavailable"); // user's own held seat
              seat.classList.add(`${tier.toLowerCase()}-seat`); // restore color
              seat.classList.add("selected");
              seat.dataset.tier = tier; // sync data attribute so getSelectedSeatLabels reads correct tier
              const seatKey = `${rowLetter}#${seatNum}`;
              if (
                seatDisabilityMap[seatKey] === true ||
                savedDisabledSeats.has(seatKey)
              ) {
                seat.classList.add("disability-accessible");
              }
              selectedTicketsCount++;
              selectedSeats[seatKey] = tier;
            }
          });
        }
      });
      return;
    }

    // Banquet: "Table A-4" → table "Table A", seat innerText "4"
    const tableMatch = label.match(/^(Table [A-Z])-(\d+)$/);
    if (tableMatch) {
      const [, tableName, seatNum] = tableMatch;
      document.querySelectorAll(".table-container").forEach((tc) => {
        const tableEl = tc.querySelector(".banquet-table");
        if (tableEl && tableEl.innerText.trim() === tableName) {
          tc.querySelectorAll(".seat").forEach((seat) => {
            if (seat.innerText.trim() === seatNum) {
              seat.classList.remove("unavailable"); // user's own held seat
              seat.classList.add(`${tier.toLowerCase()}-seat`); // restore color
              seat.classList.add("selected");
              seat.dataset.tier = tier; // sync data attribute so getSelectedSeatLabels reads correct tier
              const seatKey = `${tableName}#${seatNum}`;
              if (
                seatDisabilityMap[seatKey] === true ||
                savedDisabledSeats.has(seatKey)
              ) {
                seat.classList.add("disability-accessible");
              }
              selectedTicketsCount++;
              selectedSeats[seatKey] = tier;
            }
          });
        }
      });
    }
  });
  updateCheckoutUI();
  updateNavCartCount();
}

/**
 * Displays a transient slide-in toast notification in the bottom-right corner.
 *
 * The toast container is created lazily on first call and appended to the
 * document body. CSS keyframe animations (vtIn / vtOut) are also injected
 * into the document head on first call so this function has no external
 * stylesheet dependency.
 *
 * Toasts auto-dismiss after `duration` milliseconds, then fade out and are
 * removed from the DOM. Multiple toasts stack vertically (newest on top).
 *
 * @param {string} title    - Bold heading line at the top of the toast.
 * @param {string} [message=""] - Supporting detail text below the title.
 * @param {'success'|'error'|'info'} [type='info'] - Visual variant; controls
 *   the colored left border (green / red / neutral).
 * @param {number} [duration=3500] - Milliseconds before auto-dismiss.
 */
function showToast(title, message = "", type = "info", duration = 3500) {
  if (!document.getElementById("venue-toast-styles")) {
    const s = document.createElement("style");
    s.id = "venue-toast-styles";
    s.textContent = `
      #venue-toast-container {
        position: fixed;
        bottom: 90px;
        right: 24px;
        z-index: 9999;
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
        pointer-events: none;
      }
      .venue-toast {
        background: #0d1b2a;
        color: #fff;
        padding: 12px 16px;
        border-radius: 10px;
        border-left: 4px solid #0d1b2a;
        box-shadow: 0 8px 28px rgba(0,0,0,0.22);
        font-size: 0.9rem;
        line-height: 1.4;
        max-width: 300px;
        pointer-events: all;
        animation: vtIn 0.25s ease forwards;
      }
      .venue-toast.vtOut { animation: vtOut 0.3s ease forwards; }
      .venue-toast--success { border-left-color: #059669; }
      .venue-toast--error   { border-left-color: #b11226; }
      .venue-toast--info    { border-left-color: rgba(255,255,255,0.25); }
      .venue-toast__title { font-weight: 600; font-size: 0.92rem; margin-bottom: 2px; }
      .venue-toast__msg   { font-size: 0.84rem; opacity: 0.75; }
      @keyframes vtIn  { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
      @keyframes vtOut { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(16px); } }
    `;
    document.head.appendChild(s);
  }

  let container = document.getElementById("venue-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "venue-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `venue-toast venue-toast--${type}`;
  toast.innerHTML = `
    <div class="venue-toast__title">${title}</div>
    ${message ? `<div class="venue-toast__msg">${message}</div>` : ""}
  `;

  const dismiss = () => {
    toast.classList.add("vtOut");
    setTimeout(() => toast.remove(), 300);
  };
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

/**
 * Reads all currently selected seat elements from the DOM and converts them
 * into objects containing label and tier information for storage in localStorage.
 *
 * @returns {Array} Array of seat objects, one per selected seat.
 *   Each object has: { label: string, tier: string }
 *   Label formats:
 *   - "Row F-4"   for classroom/theater seats
 *   - "Table A-4" for banquet seats
 */
function getSelectedSeatLabels() {
  const selected = document.querySelectorAll(".seat.selected");
  return Array.from(selected).map((el) => {
    let label = "";
    const tier = el.dataset.tier || "Standard";

    // Classroom / Theater seats live inside a .seating-row element
    const row = el.closest(".seating-row");
    if (row) {
      const rowLabel =
        row.querySelector(".row-label")?.innerText?.replace("Row ", "") || "";
      label = rowLabel
        ? `Row ${rowLabel}-${el.innerText}`
        : `Seat ${el.innerText}`;
      return { label, tier };
    }

    // Banquet seats live inside a .table-container element
    const tableContainer = el.closest(".table-container");
    if (tableContainer) {
      const tableLabel =
        tableContainer.querySelector(".banquet-table")?.innerText || "";
      label = tableLabel
        ? `${tableLabel}-${el.innerText}`
        : `Seat ${el.innerText}`;
      return { label, tier };
    }

    return { label: `Seat ${el.innerText}`, tier };
  });
}

/**
 * Converts seat objects to human-readable display format.
 *
 * @param {Array} seatObjects - Array of { label, tier } objects
 * @returns {Array} Array of formatted seat strings like "Row A-1 (VIP)"
 */
function formatSeatsForDisplay(seatObjects) {
  return seatObjects.map((seat) => {
    if (typeof seat === "object" && seat.label && seat.tier) {
      let displayStr = `${seat.label} (${seat.tier}`;

      // Check if this seat is disability-accessible
      // Extract seat key from label (e.g. "Row F-4" → "F#4", "Table A-4" → "Table A#4")
      let seatKey = "";
      const rowMatch = seat.label.match(/^Row ([A-Z])-(\d+)$/);
      if (rowMatch) {
        seatKey = `${rowMatch[1]}#${rowMatch[2]}`;
      } else {
        const tableMatch = seat.label.match(/^(Table [A-Z])-(\d+)$/);
        if (tableMatch) {
          seatKey = `${tableMatch[1]}#${tableMatch[2]}`;
        }
      }

      if (seatKey && seatDisabilityMap[seatKey] === true) {
        displayStr += ", disability";
      }

      displayStr += ")";
      return displayStr;
    }
    return seat; // Fallback for string format
  });
}

/* =============================================================
   NOTIFICATIONS - SUBSCRIBE
   Handles subscribing the user's email to SNS notifications
   for the current event.

   The "Get Notified" button calls Team05's SNSClientSubscriber
   Lambda. AWS sends the user a confirmation email; once they
   click it, the subscription becomes active.

   Subscription state is persisted per (email, topicArn) pair in
   localStorage so the button stays in the "Subscribed" state on
   subsequent visits without needing a backend round-trip.
   ============================================================= */

/**
 * Reads the logged-in user's email from the localStorage shim written by
 * src/auth.js after a successful login.
 *
 * @returns {string|null} The user's email, or null if not logged in.
 */
function getLoggedInEmail() {
  return localStorage.getItem("userEmail");
}

/**
 * Checks if the user is currently logged in by checking for the userEmail
 * shim in localStorage.
 *
 * @returns {boolean} True if a user email is present.
 */
function isUserLoggedIn() {
  return getLoggedInEmail() !== null;
}

/**
 * Checks if the user is subscribed to the event's notification topic.
 * Queries the ReturnMailingList API to get the true subscription status.
 *
 * @param {string} email - User's email address.
 * @param {string} snsArn - SNS topic ARN for the event.
 * @returns {Promise<boolean>} - true if subscribed, false if not or on error.
 */
async function checkSubscriptionStatus(email, snsArn) {
  try {
    const payload = {
      topic_arn: snsArn,
      email: email,
    };

    const response = await fetch(
      "https://service.example.invalid/production/Group-5/ReturnMailingList",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      return false;
    }

    // Handle Lambda Proxy Integration wrapped response
    if (data.statusCode && data.body !== undefined) {
      if (data.statusCode >= 400) {
        return false;
      }

      // Try to parse the body if it's a string
      const bodyData =
        typeof data.body === "string" ? JSON.parse(data.body) : data.body;
      const subscribed =
        bodyData.subscribed === true && bodyData.pending === false;
      return subscribed;
    }

    // Direct response format
    if (data.subscribed !== undefined && data.pending !== undefined) {
      const subscribed = data.subscribed === true && data.pending === false;
      return subscribed;
    }

    // Error response
    if (data.error) {
      return false;
    }

    // Unexpected format
    return false;
  } catch (error) {
    console.error("Failed to check subscription status:", error);
    return false;
  }
}

/**
 * Puts the subscribe button into its "subscribed" state — enabled,
 * green background, and "Unsubscribe" label. Button can be clicked
 * to toggle off the subscription.
 *
 * @param {HTMLButtonElement} btn - The #btn-subscribe element.
 */
function setSubscribedState(btn) {
  btn.classList.add("is-subscribed");
  btn.disabled = false;
  btn.title = "Click to unsubscribe from notifications";
  btn.innerHTML = '<span class="btn-subscribe-label">🔕 Unsubscribe</span>';
}

/**
 * Restores the subscribe button to its default "Get Notified" state.
 * Called when a subscription request fails so the user can try again.
 *
 * @param {HTMLButtonElement} btn - The #btn-subscribe element.
 */
function resetToUnsubscribedState(btn) {
  btn.classList.remove("is-subscribed");
  btn.disabled = false;
  btn.title = "Subscribe to event notifications";
  btn.innerHTML = '🔔 <span class="btn-subscribe-label">Get Notified</span>';
}

/**
 * Wires up the #btn-subscribe element based on the event's notification ARN
 * and the user's actual subscription status (via API).
 *
 * - If the event has no `notification_ARN`, the button is disabled with a
 *   tooltip explaining why.
 * - If the user is logged in, checks the ReturnMailingList API to determine
 *   actual subscription status and shows the appropriate button state.
 * - Otherwise, the button is left in the default "Get Notified" state.
 *
 * @param {Object|null} eventData - Event metadata returned by the Group-2 API.
 *   Reads only the optional `notification_ARN` field.
 */
async function initializeSubscribeButton(eventData) {
  const btn = document.getElementById("btn-subscribe");
  if (!btn) return;

  eventNotificationArn = eventData?.notification_ARN || null;

  if (!eventNotificationArn) {
    btn.disabled = true;
    btn.title = "Notifications not available for this event";
    return;
  }

  // Check actual subscription status for logged-in users
  const email = getLoggedInEmail();
  if (email) {
    const subscribed = await checkSubscriptionStatus(
      email,
      eventNotificationArn,
    );
    isSubscribed = subscribed;
    if (subscribed) {
      setSubscribedState(btn);
    }
  }

  btn.addEventListener("click", toggleSubscription);
}

/**
 * Toggle handler for the subscription button. Subscribes or unsubscribes
 * the logged-in user based on their current subscription status.
 *
 * - Queries the ReturnMailingList API to check current status
 * - If subscribed: submits unsubscribe request to SNSClientSubscriber
 * - If not subscribed: submits subscribe request to SNSClientSubscriber
 * - Updates button state to reflect the new status
 *
 * Pre-conditions:
 *   - User must be logged in. If not, redirects to /login.
 *   - The event must have a `notification_ARN`.
 *
 * On success: updates button state and shows appropriate toast.
 * On failure: shows error toast and allows retry.
 */
async function toggleSubscription() {
  const btn = document.getElementById("btn-subscribe");
  if (!btn) return;

  const userEmail = getLoggedInEmail();

  if (!userEmail) {
    // Stash the current page so the user lands back here after login
    sessionStorage.setItem("radford_returnTo", window.location.href);
    window.location.href = "/login";
    return;
  }

  if (!eventNotificationArn) {
    showToast(
      "Notifications unavailable",
      "This event has no notification topic configured.",
      "error",
    );
    return;
  }

  btn.disabled = true;

  try {
    // Check current subscription status
    const currentStatus = await checkSubscriptionStatus(
      userEmail,
      eventNotificationArn,
    );

    if (currentStatus) {
      // User is subscribed, show unsubscribing state
      btn.innerHTML =
        '<span class="btn-subscribe-label">Unsubscribing...</span>';
    } else {
      // User is not subscribed, show subscribing state
      btn.innerHTML = '<span class="btn-subscribe-label">Subscribing...</span>';
    }

    // Send toggle request to SNSClientSubscriber
    const response = await fetch(`${API_BASE}/Group-5/SNSClientSubscriber`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic_arn: eventNotificationArn,
        protocol: "email",
        endpoint: userEmail,
      }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    // Update local state - toggle the opposite of what it was
    isSubscribed = !currentStatus;

    if (isSubscribed) {
      // Successfully subscribed
      setSubscribedState(btn);
      showToast(
        "Check your email",
        "We sent you a confirmation link. Click it to activate your notifications.",
        "success",
        7000,
      );
    } else {
      // Successfully unsubscribed
      resetToUnsubscribedState(btn);
      showToast(
        "Unsubscribed",
        "You will no longer receive notifications for this event.",
        "success",
      );
    }
  } catch (error) {
    console.error("Subscription toggle failed:", error);
    btn.disabled = false;

    // Restore button to current state
    if (isSubscribed) {
      btn.innerHTML = '<span class="btn-subscribe-label">Unsubscribe</span>';
    } else {
      btn.innerHTML =
        '🔔 <span class="btn-subscribe-label">Get Notified</span>';
    }

    showToast("Action failed", "Please try again or contact support.", "error");
  }
}

/* =============================================================
   CART — ADD TO CART (handler)
   ============================================================= */

/**
 * Core "Add to Cart / Modify Cart" handler for the Rolling Cart system.
 *
 * Called when the user clicks the "Add to Cart" or "Modify Cart" button.
 * Async because it must await two sequential API calls before navigating away.
 *
 * ── What this function does (in order) ───────────────────────────────────────
 *
 *  1. REMOVE case: If 0 seats are selected and the event is already in the
 *     cart, remove it from localStorage and show a "Removed" toast. Return.
 *
 *  2. BUILD cart item: Snapshot the current seat selection into a plain object
 *     and upsert it into the "radford_cart" localStorage array. This happens
 *     BEFORE the API calls so the React cart page always has something to show.
 *
 *  3. DIFF computation: Compare the current selection against `lastSavedSeats`
 *     (the state from the last successful save) to find:
 *       - newSeatKeys     — seats just added that need to be reserved
 *       - removedSeatKeys — seats just removed that need to be released
 *
 *  4. RELEASE (awaited): If there are removed seats, POST to release-tickets
 *     with the specific seat_keys. Awaited BEFORE the reserve call to prevent
 *     a race where release would wipe seats that reserve just extended.
 *
 *  5. RESERVE (awaited): If there are new seats, POST to reserve-tickets.
 *     Awaited so the expires_at timestamp is written to localStorage before
 *     the user can navigate away to /cart (the React hook reads it on mount).
 *
 *  6. 409 CONFLICT — some seats taken:
 *       a. Grey out the taken seats on the map, remove them from selectedSeats.
 *       b. Auto-retry reserve-tickets for the remaining valid seats.
 *       c. If retry succeeds: rewrite the cart item with only the valid seats,
 *          notify the user, and fall through to the success path.
 *       d. If retry fails or all seats were taken: clear cart state and return.
 *
 *  7. SUCCESS: Mark isInCart = true, snapshot lastSavedSeats, show toast.
 *
 * ── Why sequential awaits matter ─────────────────────────────────────────────
 *   Without await, the browser cancels in-flight fetch() calls the moment the
 *   user (or the code) navigates to /cart. The backend would never receive the
 *   reserve request, the hold would not be created, and the timer would not start.
 */
async function handleAddToCart() {
  const urlEventId = getQueryParam("event_id");
  const urlEventName = getQueryParam("event_name");
  // Display title: prefer the live API value already in the <h2>, fall back to URL param
  const eventTitle =
    document.querySelector(".section-title")?.innerText ||
    (urlEventName ? decodeURIComponent(urlEventName) : "Event");

  // Generate or reuse the persistent cart UUID. React's useTicketCart hook
  // reads this same key so both sides of the app share one hold_id.
  let cartId = localStorage.getItem("radford_cart_id");
  if (!cartId) {
    cartId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "cart-" +
          Math.random().toString(36).slice(2) +
          Date.now().toString(36);
    localStorage.setItem("radford_cart_id", cartId);
  }

  // If no seats selected and event is in cart, remove it
  if (selectedTicketsCount === 0 && isInCart) {
    // Release all seats from the backend before removing from cart
    if (Object.keys(lastSavedSeats).length > 0) {
      try {
        await fetch(API_BASE + "/Group-3/tickets/release-tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: urlEventId,
            hold_id: cartId,
            seat_keys: Object.keys(lastSavedSeats),
          }),
        });
      } catch (e) {}
    }

    let cart = [];
    try {
      cart = JSON.parse(localStorage.getItem("radford_cart") || "[]");
    } catch (e) {
      cart = [];
    }

    cart = cart.filter(
      (item) => item.id !== urlEventId && item.event_id !== urlEventId,
    );
    localStorage.setItem("radford_cart", JSON.stringify(cart));
    updateNavCartCount();

    isInCart = false;
    lastSavedSeats = {};
    updateCheckoutButtonState();

    showToast("Removed from cart", eventTitle, "info");
    return;
  }

  if (selectedTicketsCount === 0) return;

  // Format event date/time for display in the cart on index.html
  let dateStr = "TBD";
  let timeStr = "TBD";
  if (currentEventData?.start_date_time || currentEventData?.date_time) {
    const dt = new Date(
      currentEventData.start_date_time || currentEventData.date_time,
    );
    dateStr = dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    timeStr = dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  // Cart item shape — index.html reads all of these fields to render the cart UI
  // Build seat keys + display strings differently for Dedmon GA vs coordinate venues.
  let seatKeys = [];
  let displaySeats = [];

  if (isDedmonCenter) {
    // GA sections: selectedSeats was already populated with real seat_keys by
    // updateGACheckoutUI → rebuildGASelectedSeats. Build human-readable per-section
    // display strings here.
    seatKeys = Object.keys(selectedSeats);
    displaySeats = [];
    Object.entries(selectedGASections).forEach(([sectionLetter, selection]) => {
      const { quantity, disabilityQuantity, tier } = selection;
      if (quantity === 0 && disabilityQuantity === 0) return;
      const totalQty = quantity + disabilityQuantity;
      let displayStr = `Section ${sectionLetter} (${totalQty} ticket${totalQty !== 1 ? "s" : ""}`;
      if (disabilityQuantity > 0) {
        displayStr += `, ${disabilityQuantity} ADA`;
      }
      displayStr += `) - ${tier}`;
      displaySeats.push(displayStr);
    });
  } else {
    const seatObjects = getSelectedSeatLabels();
    seatKeys = Object.keys(selectedSeats);
    displaySeats = formatSeatsForDisplay(seatObjects);
  }

  const totalPrice = calculateSelectedTotal();
  const pricePerTicket =
    selectedTicketsCount > 0 ? totalPrice / selectedTicketsCount : 0;
  const cartItem = {
    id: urlEventId, // unique key; index.html uses this to manage cart entries
    eventId: urlEventId, // alias kept for index.html compatibility
    opponent: eventTitle, // displayed as the cart item title
    date: dateStr,
    time: timeStr,
    venue:
      currentEventData?.venue_name ||
      currentEventData?.location ||
      "Muse Banquet Hall",
    price: pricePerTicket, // average price per ticket (for index.html to multiply by quantity)
    quantity: selectedTicketsCount,
    seats: displaySeats, // Display-friendly format
    seatKeys: seatKeys, // Raw API keys (e.g. ["A#1","B#3"]) for release-tickets
    seatTiers: Object.entries(selectedSeats).map(([seatKey, tier]) => ({
      seatKey,
      tier,
    })), // Per-seat tier info for checkout pricing
    tierPrices: { ...tierPrices }, // { "VIP": 50, "Standard": 25, ... } — used by team03-write-cart to set per-tier prices in DynamoDB
    disabledSeats: seatKeys.filter(
      (seatKey) => seatDisabilityMap[seatKey] === true,
    ), // Persist disability info for held seats
    fromVenuePage: true, // tells index.html to show "Edit Seats" instead of a qty spinner
  };

  // Load the existing cart, upsert this event's entry, and persist
  let cart = [];
  try {
    cart = JSON.parse(localStorage.getItem("radford_cart") || "[]");
  } catch (e) {
    cart = [];
  }

  const existingIdx = cart.findIndex((item) => item.id === urlEventId);
  if (existingIdx >= 0) {
    cart[existingIdx] = cartItem; // Replace existing entry (seat selection was updated)
  } else {
    cart.push(cartItem); // First time this event is added to the cart
  }

  localStorage.setItem("radford_cart", JSON.stringify(cart));
  updateNavCartCount();

  // Compute diff vs last saved state to avoid re-reserving already-held seats.
  // lastSavedSeats is set to the preselected seats on page load (edit mode)
  // so only genuinely new seats are sent to reserve-tickets.
  const newSeatKeys = Object.keys(selectedSeats).filter(
    (k) => !lastSavedSeats[k],
  );
  const removedSeatKeys = Object.keys(lastSavedSeats).filter(
    (k) => !selectedSeats[k],
  );

  // Release seats that were removed from the selection.
  // Awaited so it completes before reserve-tickets fires — prevents a race
  // where release wipes seats that reserve just extended.
  if (removedSeatKeys.length > 0) {
    try {
      await fetch(API_BASE + "/Group-3/tickets/release-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: urlEventId,
          hold_id: cartId,
          seat_keys: removedSeatKeys,
        }),
      });
    } catch (e) {}
  }

  // Reserve only genuinely new seats. Awaited so the response (expires_at)
  // is written to localStorage before the user can navigate away to /cart.
  if (newSeatKeys.length > 0) {
    try {
      // owner_id is the Cognito sub (immutable UUID), read from the
      // localStorage shim written by src/auth.js. Preferred over email
      // because sub never changes and matches what Team 04 extracts
      // from the token during payment. Omitted when not logged in so
      // anonymous browsing still works.
      const ownerId = localStorage.getItem("userSub") || undefined;
      const res = await fetch(API_BASE + "/Group-3/tickets/reserve-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: urlEventId,
          seat_keys: newSeatKeys,
          cart_id: cartId,
          ...(ownerId ? { owner_id: ownerId } : {}),
        }),
      });
      const raw = await res.json();
      // API Gateway on this route returns the Lambda envelope as the HTTP body.
      // Unwrap it so we can read the actual fields.
      const data =
        raw && typeof raw.body === "string" ? JSON.parse(raw.body) : raw;
      if (data && data.expires_at) {
        localStorage.setItem("radford_cart_expiry", data.expires_at);
      }
      // Save ticket_ids into the cart item so My Tickets can generate QR codes
      if (
        data &&
        Array.isArray(data.ticket_ids) &&
        data.ticket_ids.length > 0
      ) {
        let c = [];
        try {
          c = JSON.parse(localStorage.getItem("radford_cart") || "[]");
        } catch (e2) {
          c = [];
        }
        const ci = c.findIndex((item) => item.id === urlEventId);
        if (ci >= 0) {
          const prev = c[ci].ticketIds || [];
          c[ci].ticketIds = [...new Set([...prev, ...data.ticket_ids])];
          localStorage.setItem("radford_cart", JSON.stringify(c));
        }
      }
      if (data && data.reserved === false && data.unavailable) {
        const unavailableSet = new Set(data.unavailable);

        // Update the seat map: mark taken seats as unavailable, deselect them
        data.unavailable.forEach((seatKey) => {
          const [rowLetter, seatNum] = seatKey.split("#");
          document.querySelectorAll(".seating-row").forEach((row) => {
            const labelEl = row.querySelector(".row-label");
            if (labelEl && labelEl.innerText.trim() === `Row ${rowLetter}`) {
              row.querySelectorAll(".seat").forEach((seat) => {
                if (seat.innerText.trim() === seatNum) {
                  seat.classList.remove("selected");
                  seat.classList.remove(
                    "vip-seat",
                    "standard-seat",
                    "budget-seat",
                  );
                  seat.classList.add("unavailable");
                  delete selectedSeats[seatKey];
                  selectedTicketsCount--;
                }
              });
            }
          });
        });
        updateCheckoutUI();
        updateCheckoutButtonState();

        const takenMsg = `Seat(s) ${data.unavailable.join(", ")} were just taken by another buyer.`;

        // Seats the user picked that weren't in the conflict list — reserve those automatically
        const stillValid = newSeatKeys.filter((k) => !unavailableSet.has(k));

        if (stillValid.length > 0) {
          // Auto-retry for the conflict-free seats
          let retryOk = false;
          try {
            const retryRes = await fetch(
              API_BASE + "/Group-3/tickets/reserve-tickets",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  event_id: urlEventId,
                  seat_keys: stillValid,
                  cart_id: cartId,
                  ...(ownerId ? { owner_id: ownerId } : {}),
                }),
              },
            );
            const retryRaw = await retryRes.json();
            const retryData =
              retryRaw && typeof retryRaw.body === "string"
                ? JSON.parse(retryRaw.body)
                : retryRaw;
            if (
              retryData &&
              retryData.reserved !== false &&
              !retryData.unavailable
            ) {
              if (retryData.expires_at) {
                localStorage.setItem(
                  "radford_cart_expiry",
                  retryData.expires_at,
                );
              }
              // Save ticket_ids from the retry response too
              if (
                Array.isArray(retryData.ticket_ids) &&
                retryData.ticket_ids.length > 0
              ) {
                let c = [];
                try {
                  c = JSON.parse(localStorage.getItem("radford_cart") || "[]");
                } catch (e2) {
                  c = [];
                }
                const ci = c.findIndex((item) => item.id === urlEventId);
                if (ci >= 0) {
                  const prev = c[ci].ticketIds || [];
                  c[ci].ticketIds = [
                    ...new Set([...prev, ...retryData.ticket_ids]),
                  ];
                  localStorage.setItem("radford_cart", JSON.stringify(c));
                }
              }
              retryOk = true;
            }
          } catch (e) {}

          if (retryOk) {
            // Rewrite the cart item with only the successfully reserved seats.
            // The item written earlier captured all seats before the conflict was known;
            // selectedSeats/selectedTicketsCount have since been corrected by the loop above.
            const retryTotal = calculateSelectedTotal();
            const retryPricePerTicket =
              selectedTicketsCount > 0 ? retryTotal / selectedTicketsCount : 0;
            const updatedItem = {
              ...cartItem,
              price: retryPricePerTicket,
              quantity: selectedTicketsCount,
              seats: formatSeatsForDisplay(getSelectedSeatLabels()),
              seatKeys: Object.keys(selectedSeats),
            };
            let updatedCart = [];
            try {
              updatedCart = JSON.parse(
                localStorage.getItem("radford_cart") || "[]",
              );
            } catch (e2) {
              updatedCart = [];
            }
            const updatedIdx = updatedCart.findIndex(
              (item) => item.id === urlEventId,
            );
            if (updatedIdx >= 0) {
              updatedCart[updatedIdx] = updatedItem;
            } else {
              updatedCart.push(updatedItem);
            }
            localStorage.setItem("radford_cart", JSON.stringify(updatedCart));
            updateNavCartCount();

            // Partial success — notify and fall through to cart add with the remaining seats
            alert(
              `${takenMsg}\nYour remaining seat(s) have been added to your cart.`,
            );
            // (no return — falls through to the cart-add logic below)
          } else {
            // Retry also failed — abort entirely
            let cart = [];
            try {
              cart = JSON.parse(localStorage.getItem("radford_cart") || "[]");
            } catch (e2) {
              cart = [];
            }
            cart = cart.filter(
              (item) => item.id !== urlEventId && item.event_id !== urlEventId,
            );
            localStorage.setItem("radford_cart", JSON.stringify(cart));
            updateNavCartCount();
            isInCart = false;
            lastSavedSeats = {};
            alert(
              `${takenMsg}\nCould not reserve remaining seats. Please try again.`,
            );
            return;
          }
        } else {
          // Every seat the user picked is gone
          let cart = [];
          try {
            cart = JSON.parse(localStorage.getItem("radford_cart") || "[]");
          } catch (e) {
            cart = [];
          }
          cart = cart.filter(
            (item) => item.id !== urlEventId && item.event_id !== urlEventId,
          );
          localStorage.setItem("radford_cart", JSON.stringify(cart));
          updateNavCartCount();
          isInCart = false;
          lastSavedSeats = {};
          alert(
            `Sorry, ${takenMsg}\nAll your selected seats are gone. Please choose different seats.`,
          );
          return;
        }
      }
    } catch (e) {} // Non-blocking fallback — backend will auto-expire if unreachable
  }

  // Mark this event as in the cart and save the current selection as the baseline
  isInCart = true;
  lastSavedSeats = { ...selectedSeats };
  updateCheckoutButtonState();

  const ticketWord = selectedTicketsCount === 1 ? "ticket" : "tickets";
  showToast(
    "Added to cart",
    `${selectedTicketsCount} ${ticketWord} — ${eventTitle}`,
    "success",
  );
}

/* =============================================================
   INITIALISATION — Entry Point
   The DOMContentLoaded listener below is the single entry point
   for this entire script. It runs after the HTML is fully parsed
   and orchestrates all API calls and DOM rendering.

   Execution order:
     1. Read event_id from the URL — show error and abort if missing.
     2. Fetch event metadata (name, date, venue, layout style).
     3. Concurrently fetch: available seats, pricing, discounts.
     4. Merge discounts into pricing to get effective prices.
     5. Update the page heading with live event info.
     6. Lock the layout selector to this event's configured style.
     7. Render all seat map layouts (CSS shows only the active one).
     8. Restore any seats already saved in the cart for this event.
     9. Wire up the "Add to Cart" button.
   ============================================================= */

// ── Header auth init ─────────────────────────────────────────────────────────
// Mirrors the React Header.jsx logic for the static venue.html page so the
// header looks identical on both pages.
function initVenueHeader() {
  const email = localStorage.getItem("userEmail");
  const guestEl = document.getElementById("user-status-guest");
  const userEl  = document.getElementById("header-user");
  const avatarBtn = document.getElementById("header-avatar-btn");
  const dropdown  = document.getElementById("header-dropdown");
  const emailEl   = document.getElementById("header-dropdown-email");
  const logoutBtn = document.getElementById("header-logout-btn");

  if (!email) {
    if (guestEl) guestEl.style.display = "";
    return;
  }

  // Show logged-in state
  if (guestEl) guestEl.style.display = "none";
  if (userEl)  userEl.style.display  = "";

  // Populate email in dropdown
  if (emailEl) {
    let html = email;
    try {
      const profile = JSON.parse(localStorage.getItem("userProfile") || "null");
      if (profile?.photoUrl && avatarBtn) {
        avatarBtn.innerHTML = `<img src="${profile.photoUrl}" alt="Profile" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      }
      if (profile?.Type && profile?.Role) {
        html += `<span style="display:block;margin-top:4px;font-size:0.78rem;color:#b11226;font-weight:600">${profile.Type} · ${profile.Role}</span>`;
      }
    } catch { /* ignore */ }
    emailEl.innerHTML = html;
  }

  // Toggle dropdown on avatar click
  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dropdown.style.display === "block";
      dropdown.style.display = open ? "none" : "block";
    });
    document.addEventListener("click", () => { dropdown.style.display = "none"; });
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      ["idToken","accessToken","token","userEmail","userSub","userProfile",
       "radford_cart","radford_cart_id","radford_cart_expiry"].forEach(k => localStorage.removeItem(k));
      ["idToken","accessToken","refreshToken","tokenExpiresAt"].forEach(k => sessionStorage.removeItem(k));
      window.location.href = "/login";
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initVenueHeader();

  // ── Step 1: Require event_id ──────────────────────────────────────────────
  const urlEventId = getQueryParam("event_id");

  if (!urlEventId) {
    // No event was specified — page was opened without a valid event link
    showNoEventError();
    return;
  }

  // ── Step 2: Fetch event metadata ──────────────────────────────────────────
  let eventData = await fetchEventById(urlEventId);

  // If ID-based fetch fails, fall back to a text search using the event name
  if (!eventData) {
    const urlEventName = getQueryParam("event_name");
    if (urlEventName) {
      console.warn("fetchEventById failed — falling back to name search.");
      eventData = await searchEventByName(urlEventName);
    }
  }

  // If all API strategies fail, use a minimal stub so the seat map still renders.
  // Ticket data (available/sold states) will still drive the seat availability display.
  if (!eventData) {
    console.warn(
      "Event metadata unavailable — loading seat map with ticket data only.",
    );
    eventData = { event_id: urlEventId };
  }

  // Use event_name from the URL as a title fallback when API metadata is missing
  if (!eventData.event_name) {
    const urlEventName = getQueryParam("event_name");
    if (urlEventName) eventData.event_name = decodeURIComponent(urlEventName);
  }

  currentEventData = eventData;
  updateEventHeader(eventData);

  // Initialize the subscribe button with event data
  await initializeSubscribeButton(eventData);

  // ── Step 3: Fetch tickets, pricing, and discounts concurrently ────────────
  // Always use the original URL event_id for Team03 API calls.
  // The name-search fallback may return a different event_id that Team03
  // doesn't recognise, so we deliberately ignore it for ticketing calls.
  const eventId = urlEventId;

  // Detect Dedmon early so we can pick the per-section ticket fetch strategy,
  // which sidesteps the 502 timeout we see on the unfiltered Dedmon response.
  // Graduation adds one extra virtual section ("Students Section") on top of
  // the standard A–P set so the centerpiece card has ticket data to read.
  const isDedmonEvent = eventData?.venue_name === "Dedmon Center";
  const isGraduationEvent =
    isDedmonEvent && eventData?.layout_name === "Graduation";
  const graduationSectionList = isGraduationEvent
    ? [...Object.keys(DEDMON_SECTIONS), "Students Section"]
    : undefined;
  const ticketsPromise = isDedmonEvent
    ? fetchDedmonTickets(eventId, graduationSectionList)
    : fetchTickets(eventId);

  // Kick off the Student Section ownership lookup in parallel with the
  // ticket/pricing fetches. Completes before generateGraduation runs below
  // so the centerpiece can render in the correct disabled state.
  const ownershipPromise = isGraduationEvent
    ? checkStudentsSectionOwnership(eventId)
    : Promise.resolve();

  const [ticketData, pricingTiers, discounts] = await Promise.all([
    ticketsPromise,
    fetchPricingTiers(eventId),
    fetchDiscounts(eventId),
  ]);
  await ownershipPromise;

  const availableKeys = ticketData.availableKeys;
  const seatTierMap = ticketData.seatTierMap;
  seatDisabilityMap = ticketData.seatDisabilityMap;
  allAvailableTickets = ticketData.allTickets || [];

  // ── Step 4: Apply discounts to the base pricing ───────────────────────────
  // Start with base prices, then override any tier that has an active discount
  const effectivePrices = { ...pricingTiers };
  discounts.forEach((d) => {
    if (d.tier && d.discount_price !== undefined) {
      effectivePrices[d.tier] = Number(d.discount_price);
    }
  });

  // Store all tier prices for use in calculations
  tierPrices = effectivePrices;
  tierOriginalPrices = pricingTiers;

  // Set TICKET_PRICE to Standard for legacy compatibility (used in cart label)
  if (effectivePrices["Standard"] !== undefined) {
    TICKET_PRICE = effectivePrices["Standard"];
    ORIGINAL_TICKET_PRICE =
      pricingTiers["Standard"] !== undefined
        ? pricingTiers["Standard"]
        : TICKET_PRICE;
    IS_DISCOUNTED = discounts.some((d) => d.tier === "Standard");
    if (IS_DISCOUNTED) {
      console.log(
        `Standard discount applied: $${ORIGINAL_TICKET_PRICE} → $${TICKET_PRICE}`,
      );
    }
  } else {
    console.warn(
      "Standard tier price not found — checkout total will show $0.00.",
    );
  }

  console.log("Loaded tier prices:", tierPrices);
  updatePricingDisplay();

  // ── Step 5: Lock to event's configured layout (if specified) ──────────────
  const venueName = eventData?.venue_name ?? null;
  const layoutName = eventData?.layout_name ?? null;

  // Detect if this is Dedmon Center (GA sections venue). Both "All Section"
  // and "Graduation" layouts trigger the GA code paths (cart building,
  // preselect, per-section fetch).
  isDedmonCenter = venueName === "Dedmon Center";
  isGraduation = isDedmonCenter && layoutName === "Graduation";

  if (venueName && layoutName) {
    // Disable layout tabs that don't match this event's venue configuration
    showOnlyLayout(venueName, layoutName);
  }

  // ── Step 6: Render seat maps ───────────────────────────────────────────────
  // All layouts are always built into the DOM; CSS controls which is visible.
  // When layoutName is null (event has no specific style), all are rendered
  // and the user can switch between them using the tab buttons.
  if (layoutName === "Classroom" || layoutName === null)
    generateClassroom(availableKeys, seatTierMap, seatDisabilityMap);
  if (layoutName === "Theater" || layoutName === null)
    generateTheater(availableKeys, seatTierMap, seatDisabilityMap);
  if (layoutName === "Banquet" || layoutName === null)
    generateBanquet(availableKeys, seatTierMap, seatDisabilityMap);
  // "All Section" is the singular layout for the Bonnie Auditorium venue.
  if (layoutName === "All Section" && venueName === "Bonnie Auditorium")
    generateBonnie(availableKeys, seatTierMap, seatDisabilityMap);
  // Dedmon Center — General Admission sections
  if (layoutName === "All Section" && venueName === "Dedmon Center")
    generateDedmon(availableKeys, seatTierMap, seatDisabilityMap);
  // Dedmon Center — Graduation ceremony layout
  if (layoutName === "Graduation" && venueName === "Dedmon Center")
    generateGraduation(availableKeys, seatTierMap, seatDisabilityMap);
  // Fallback: when layoutName is null, still render Bonnie so classroom/theater/banquet users can pick
  if (layoutName === null)
    generateBonnie(availableKeys, seatTierMap, seatDisabilityMap);

  // ── Step 7: Restore cart state ────────────────────────────────────────────
  // If the user already selected seats for this event, re-highlight them so
  // the seat map reflects their current cart selection on return visits
  try {
    const storedCart = JSON.parse(localStorage.getItem("radford_cart") || "[]");
    const existing = storedCart.find((item) => item.id === urlEventId);
    if (
      existing &&
      isDedmonCenter &&
      Array.isArray(existing.seatKeys) &&
      existing.seatKeys.length > 0
    ) {
      preselectDedmonSections(existing.seatKeys, existing.disabledSeats || []);
      isInCart = true;
      lastSavedSeats = { ...selectedSeats };
    } else if (
      existing &&
      Array.isArray(existing.seats) &&
      existing.seats.length > 0
    ) {
      preselectSeats(existing.seats, existing.disabledSeats || []);
      isInCart = true;
      // Copy selectedSeats to lastSavedSeats to mark current state as "saved"
      lastSavedSeats = { ...selectedSeats };
    }
  } catch (e) {}

  // ── Step 8: Wire up the checkout button ────────────────────────────────────
  const checkoutBtn = document.getElementById("btn-checkout");
  if (checkoutBtn) checkoutBtn.addEventListener("click", handleAddToCart);

  updateCheckoutButtonState();
  updateNavCartCount();

  // ── Step 9: Initialize the notification subscription button ──────────────
  await initializeSubscribeButton(eventData);

  // ── Step 10: Reveal the page ──────────────────────────────────────────────
  // All data is fetched and the seat map is rendered — tear down the overlay
  // painted by venue.html so the user sees a fully populated page, not a
  // half-rendered one.
  hideVenueLoader();
});

// Safety net: if the init flow above ever throws an unhandled error, the
// loader would otherwise stay up forever. This fires once per page load and
// guarantees the overlay comes down regardless of what init did or didn't do.
window.addEventListener("load", () => {
  // Give the async init a reasonable window to finish on slow networks before
  // we force-reveal the page. 15s matches the worst-case backend latency we've
  // observed on the Dedmon ticket endpoint.
  setTimeout(hideVenueLoader, 15000);
});
