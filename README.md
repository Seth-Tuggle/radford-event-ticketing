# Radford Event Ticketing / Event Horizon

I worked on Event Horizon for CS472 at Radford University. The project brings
together campus event browsing, ticket carts, seat selection, and analytics.
I keep the event handlers, API testing pages, and shared frontend in separate
folders so it's easier to find each part.

## What's in the repository

- `backend/LambdaCode/`: Python handlers for event creation, updates, search,
  categories, and uploaded assets.
- `backend/test_createEvent_lambda.py`: event-creation tests that run in local mode.
- `api-testing/`: API testing pages and a mock interface.
- `frontend/`: the shared React/Vite interface, including ticket, seating, and
  analytics pages.

## Running locally

Use a Node version compatible with the Vite version in `frontend/package.json`.
From `frontend`, run `npm ci`, then `npm run dev`.

Browsing has a local example-data fallback. Login, checkout, seating, and analytics
still need backend services outside this repository. The school service addresses
have been replaced with `service.example.invalid`, and the Cognito settings use
example values. Configure your own services before trying those flows. The
frontend architecture is described in `frontend/README.md` and
`frontend/src/README.md`.

For the backend tests, install `backend/requirements.txt` and run this command
from the repository root:

```bash
python -m pytest backend/test_createEvent_lambda.py
```

Check each handler's environment settings before deploying it. Only run the seed
script against a service where you intend to create example events.

## Project status

This is the coursework version of the project. Several services are maintained
outside this repository, so the files here aren't a complete deployment on their
own. Authentication and transaction flows still need integration and security
testing before a production deployment.

## Ownership

For details about my contributions and project attribution, see [CREDITS.md](CREDITS.md).
