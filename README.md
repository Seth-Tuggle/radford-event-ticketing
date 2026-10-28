# Radford Event Ticketing / Event Horizon

Event discovery and ticketing coursework, recovered from CS472 at Radford University.

## Contribution and team ownership

Seth Tuggle built the event APIs and search/category functions and used AI to
develop the API testing page. The main frontend was put together by a different
team. It is included for integration context and credited as shared team work;
it is not presented as Seth's independently authored frontend.

## Layout

- `backend/LambdaCode/`: Python event CRUD, search, categories, and asset handlers.
- `backend/test_createEvent_lambda.py`: existing event-creation tests using local mode.
- `api-testing/`: API testing pages and the recovered mock interface.
- `frontend/`: the fuller shared React/Vite app recovered from a nested ZIP,
  including cart, venue/seat selection, tickets, and analytics.

## Local setup

Use a Node version compatible with the Vite version in `frontend/package.json`.
From `frontend`, run `npm ci` and `npm run dev`. The frontend's existing local
event fallback may display example events; login, checkout, seating, and analytics
still depend on the documented external team APIs. The original school service
addresses have been replaced with `service.example.invalid` and Cognito IDs with
examples. Configure your own services before trying integrated flows. Consult
`frontend/README.md` and `frontend/src/README.md` for the recovered architecture.

For backend checks, install `backend/requirements.txt`, then run
`python -m pytest backend/test_createEvent_lambda.py` from the repository root.
Read each handler's environment settings before deploying it. Do not run the
seed script against any service unless you intend to create example events.

## Status

Recovered snapshots from separate teams/stages have been kept in separate folders.
This is not a complete independently deployable copy of every team's backend.
The original school deployment has not been used during recovery. Authentication
and transaction code remain coursework prototypes, not a production readiness claim.

See `RECOVERY_NOTES.md` for snapshot provenance.
