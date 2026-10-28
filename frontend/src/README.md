# `src/` — React Single-Page Application

This directory contains the React side of the Radford Events Ticketing
app. The static seat-map page lives in `../public/venue.html` and is
documented separately. See the project root `README.md` for the
high-level architecture and the rationale behind the React + static
hybrid.

## Module map

```
src/
├── main.jsx              ← Entry point. Mounts <App/> inside
│                           React.StrictMode + BrowserRouter.
├── App.jsx               ← Route map and persistent layout shell
│                           (Header / Nav / main / Footer). Also
│                           handles the Cognito ?code= callback on
│                           mount.
├── auth.js               ← All authentication logic. Cognito PKCE
│                           SSO + direct API login + token storage
│                           (sessionStorage + localStorage shims).
├── index.css             ← Global styles for the SPA. Imports
│                           ../public/shared-shell.css for the
│                           header, nav, and footer (so the React
│                           pages and venue.html stay visually
│                           in sync).
│
├── components/
│   ├── Header.jsx        ← Branding bar. Reads userEmail from
│   │                       localStorage and shows the user menu.
│   ├── Nav.jsx           ← Top navigation. Live cart-count badge
│   │                       updated via the "cartUpdated" custom
│   │                       event and the native "storage" event.
│   ├── EventBoard.jsx    ← Landing page. Fetches events from the
│   │                       Team02 endpoint, falls back to local
│   │                       MOCK_EVENTS if the API is unreachable.
│   ├── Cart.jsx          ← Cart review and checkout. Renders one
│   │                       row per cart item plus the timer and
│   │                       the expiry modal.
│   ├── CartTimer.jsx     ← Drift-proof MM:SS countdown. Calculates
│   │                       remaining time from the wall clock on
│   │                       every tick so it survives tab dormancy.
│   ├── Login.jsx         ← Two-column auth card. SSO and direct
│   │                       API login + signup forms.
│   └── MyTickets.jsx     ← Purchased tickets with live QR codes.
│                           Calls /generate-qr per ticket on mount.
│
├── hooks/
│   └── useTicketCart.js  ← Central cart state machine. Owns
│                           cartItems, cartId, and expiresAt.
│                           Synchronizes with venue.html via
│                           localStorage and a custom event.
│
└── services/
    └── ApiService.js     ← Centralized API client. One function
                            per backend endpoint, returns a typed
                            { success, data } result instead of
                            throwing so callers don't need
                            try/catch.
```

## Reading order

If you've never seen this code before, walk it in this order:

1. `main.jsx` — what gets mounted and where.
2. `App.jsx` — the routes and the SSO callback path.
3. `services/ApiService.js` — every backend call we make, in one place.
4. `hooks/useTicketCart.js` — how cart state is shared with `venue.html`.
5. `components/Cart.jsx` — how the cart UI consumes the hook.
6. `components/CartTimer.jsx` — how the expiry countdown works.
7. `components/EventBoard.jsx` — the landing page and its fallback.
8. `components/MyTickets.jsx` — how QR codes are fetched and rendered.
9. `auth.js` — the full Cognito PKCE flow with token storage.
10. `components/Login.jsx` — how the auth UI calls into `auth.js`.

## Conventions

- **Every file starts with a JSDoc `@file` block** describing its
  responsibility, data it reads or writes, and how it talks to
  the rest of the system.
- **Every exported function has a JSDoc** with parameter and return
  types so the IDE can surface them on hover.
- **Inline comments explain "why," not "what."** If you find yourself
  reading a comment that just restates the code, please remove it.
- **Cross-page coordination uses `localStorage`** plus the synthetic
  `cartUpdated` custom event for same-tab updates (the native
  `storage` event only fires on *other* tabs).
- **API errors do not throw.** `ApiService.apiFetch()` returns
  `{ success: false, data: null }` on any failure so the UI never
  crashes. Components are responsible for showing friendly error
  states.

## Adding a new page

1. Create the component in `components/`.
2. Add a `<Route>` for it inside `<Routes>` in `App.jsx`.
3. Add a `navLink(...)` for it in `components/Nav.jsx`.
4. If it needs backend data, add the call to `services/ApiService.js`
   instead of using `fetch` directly — this keeps every endpoint in
   one place and makes it easy to find what's deployed.
