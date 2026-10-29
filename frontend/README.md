# Radford Events Ticketing

> **Historical coursework:** This frontend is preserved as part of the original
> CS472 class project. It depended on shared class APIs and AWS services. It is
> not maintained as a standalone application; dependencies and services may be
> outdated, deprecated, or unavailable. The architecture and commands below are
> historical reference, not a verified local setup. Event browsing requires a
> working API and shows an empty list on failure; there is no mock-event fallback.

A web application for browsing campus events, reserving seats with a live
hold-and-checkout flow, and viewing purchased tickets with QR codes.
Built for CS472 at Radford University.

## Architecture at a glance

The application is a hybrid: a React single-page app for the main pages
(browse, cart, login, my tickets) plus a separate static `venue.html`
page for interactive seat selection. The two halves share state through
`localStorage` and converge on the same backend APIs.

```
┌──────────────────────────────────────────────────────────────────┐
│                    Browser (single origin)                       │
│                                                                  │
│  ┌─────────────────────────────┐    ┌────────────────────────┐   │
│  │  React SPA  (src/)          │    │  venue.html (public/)  │   │
│  │  - EventBoard               │◀──▶│  - Seat map renderer   │   │
│  │  - Cart                     │    │  - Add-to-cart handler │   │
│  │  - MyTickets                │    │  - Plain JS, no build  │   │
│  │  - Login (Cognito + API)    │    │                        │   │
│  └─────────────────────────────┘    └────────────────────────┘   │
│              │                                  │                │
│              └──────── localStorage ────────────┘                │
│                  • radford_cart        (cart items)              │
│                  • radford_cart_id     (hold UUID)               │
│                  • radford_cart_expiry (ISO timestamp)           │
│                  • token / userEmail   (auth shims)              │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                  ┌─────────────────────────────┐
                  │  AWS API Gateway            │
                  │  + Lambda functions         │
                  │  + DynamoDB / S3 / SNS      │
                  │  + Cognito Hosted UI        │
                  └─────────────────────────────┘
```

### Why a hybrid?
The React app handles routing, auth, and the cart UI. The seat map
lives in a separate static page because it pre-dates the React rewrite
and uses a separate vanilla JavaScript renderer. Both pages share
`localStorage` keys and the backend `cart_id` to coordinate the flow.

## Project layout

```
application/
├── index.html              ← Vite entry; mounts React into #root
├── src/                    ← React single-page app
│   ├── main.jsx            ← Bootstraps React + BrowserRouter
│   ├── App.jsx             ← Layout shell + route map + SSO callback
│   ├── auth.js             ← Cognito PKCE flow + token storage
│   ├── components/
│   │   ├── Header.jsx      ← Branding bar with logged-in user menu
│   │   ├── Nav.jsx         ← Top nav with live cart count badge
│   │   ├── EventBoard.jsx  ← Landing page; lists events
│   │   ├── Cart.jsx        ← Cart review and checkout
│   │   ├── CartTimer.jsx   ← Drift-proof 10-minute countdown
│   │   ├── Login.jsx       ← Sign-in / sign-up forms
│   │   └── MyTickets.jsx   ← Purchased tickets with live QR codes
│   ├── hooks/
│   │   └── useTicketCart.js ← Cart state hook + cross-page sync
│   ├── services/
│   │   └── ApiService.js   ← Centralized API client
│   └── index.css           ← React app styles
├── public/                 ← Served as-is (no build step)
│   ├── venue.html          ← Static seat-map page
│   ├── venue-app.js        ← Seat map logic (vanilla JS)
│   ├── venue-styles.css    ← Seat map styles
│   └── shared-shell.css    ← Header / nav / footer (used by both)
├── vite.config.js
├── eslint.config.js
└── package.json
```

## The Rolling Cart flow

This is the central concept the rest of the application is organized
around. When a user clicks "Add to Cart" on `venue.html`, the app
sequences three things:

1. **Reserve** — `POST /Group-3/tickets/reserve-tickets` puts the seats
   into HELD state in DynamoDB, scoped to a `cart_id` UUID. The
   response includes `expires_at` (ISO timestamp, ~10 minutes out).
2. **Persist locally** — the cart item, `cart_id`, and `expires_at`
   are written to `localStorage` so both pages can read them.
3. **Countdown** — `CartTimer` reads `expires_at` and shows a live
   countdown. The backend SQS worker autonomously releases held seats
   at exactly the same moment, so the frontend trusts the backend as
   authoritative and only needs to clear local state at expiry.

The same `cart_id` is used as `hold_id` for `release-tickets` and is
handed to the payment team on checkout.

See `src/hooks/useTicketCart.js` for the React side and
`public/venue-app.js` `handleAddToCart()` for the seat-map side.

## Authentication

Two flows, both implemented in `src/auth.js`:

- **Cognito SSO (PKCE)** — Primary path. `initiateSSORedirect()` sends
  the user to Cognito Hosted UI; on return, `App.jsx` detects the
  `?code=` query param and calls `exchangeCodeForTokens()`.
- **Direct API login/signup** — Username/password against Team01's
  endpoints, for accounts not tied to Radford SSO.

Tokens live in `sessionStorage` (cleared on tab close). For backwards
compatibility, the access token, user email, and Cognito sub are
mirrored into `localStorage` shims (`token`, `userEmail`, `userSub`)
that the legacy components and `venue-app.js` read directly.

## Backend teams

The frontend is one of seven teams collaborating on this system. Each
backend team owns a different slice of the API. See
`src/services/ApiService.js` for the full endpoint map.

| Team   | Owns                                       |
|--------|--------------------------------------------|
| Team01 | User profiles / direct auth API            |
| Team02 | Events CRUD                                |
| Team03 | Tickets — reserve, release, sell, QR codes |
| Team04 | Stripe payment processing                  |
| Team05 | Cognito authentication                     |
| Team07 | API Gateway and User Management            |

## Historical development commands

These commands describe the original development workflow and still require the
class service configuration; they are retained as reference.

```bash
npm install
npm run dev      # http://localhost:5173 with HMR
npm run build    # production build into dist/
npm run lint     # ESLint
npm run preview  # serve the dist/ build locally
```

The dev server proxies `/venue.html`, `/venue-app.js`, etc. directly
from `public/` — no special routing needed. The React app and the seat
map page run on the same origin so they can share `localStorage`.

## Where to start reading

For a developer new to the codebase, read in this order:

1. `src/main.jsx` — entry point and provider setup.
2. `src/App.jsx` — route map and SSO callback handling.
3. `src/services/ApiService.js` — shared API helpers and endpoint mapping.
4. `src/hooks/useTicketCart.js` — the central cart state machine.
5. `public/venue-app.js` — the seat-map page (start with the
   `DOMContentLoaded` listener at the bottom — it's the entry point).
6. `src/components/Cart.jsx` and `src/components/CartTimer.jsx` —
   how the React side renders the cart and the expiry timer.

The source includes JSDoc blocks describing module responsibilities, shared
data, and interactions with the rest of the system.

---

Built for Radford Highlanders.
