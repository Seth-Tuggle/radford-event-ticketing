# Radford Event Ticketing / Event Horizon

I worked on Event Horizon for CS472 at Radford University. The project brought
together campus event browsing, ticket carts, seat selection, and analytics. I
keep the event handlers, API testing pages, and shared frontend in separate
folders so each part is easier to explore.

## Historical coursework

I'm preserving this repository to describe the class project and host its main
code. It was designed around a shared class environment with AWS services and
APIs maintained by several teams. I'm not maintaining it as a standalone app;
dependencies, endpoints, and service configurations may now be outdated,
deprecated, or unavailable.

## Main code

- `backend/LambdaCode/`: Python event, search, category, and asset handlers.
- `backend/test_createEvent_lambda.py`: local-mode event-creation tests.
- `api-testing/`: API testing pages and a mock interface.
- `frontend/`: the shared React/Vite interface, including tickets, seating,
  and analytics. Its nested READMEs describe the original architecture.

School service addresses have been replaced with `service.example.invalid`,
and Cognito settings use example values. The complete class backend isn't
included. Event browsing needs working APIs and shows an empty event list when
requests fail; it does not have an offline mock-event fallback. The testing
pages are separate from that frontend behavior.

The files here preserve the coursework version, including its integration and
prototype limitations. They aren't a complete deployment or a verified setup
for an individual device.

## Ownership

For details about my contributions and project attribution, see [CREDITS.md](CREDITS.md).
