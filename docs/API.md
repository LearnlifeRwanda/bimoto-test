# Bimoto API Documentation

**The API is documented in the code, not here.**

Every route carries an `@openapi` annotation block beside the handler it
describes. `swagger-jsdoc` compiles those blocks into an OpenAPI spec that
the server serves directly:

| What | Where |
|------|-------|
| Browsable docs (Swagger UI) | `GET /api/docs` |
| Raw OpenAPI JSON | `GET /api/docs.json` |

Both are public by design, so a contributor or integrator can read the
contract without a session. Locally that is <http://localhost:3000/api/docs>
once `pnpm dev:server` is up.

## Why this file no longer lists endpoints

It used to. It documented 42 endpoints by hand while the server registered
around 170, and the 42 had drifted:

- Six journey actions were documented as `PATCH` and are `POST` in the code
  — `/journeys/:id/{start,end,cancel,confirm,dispute,interrupt}`. Every one
  of those was a `curl` example that returns 404 for anyone who copied it.
- Several documented paths did not exist at all: `GET /journeys/nearby`,
  `POST /users/me/emergency-contacts`, `POST /journeys/:journeyId/ratings`,
  and `POST /journeys/:journeyId/upload/:type` (uploads take literal photo
  types, not a `:type` parameter).
- Nothing shipped since — per-bid decline, arrival confirmation, emergency
  alerts, the simulated-SMS inbox, the cooperative and mobility surfaces —
  appeared here at all.

The in-code annotations were current the whole time. This file was a second
copy of the truth that nothing kept honest, and a wrong `curl` is worse than
no `curl`: it sends the reader looking for their own mistake.

Restoring the list by hand would rebuild exactly the thing that drifted, so
it is deliberately not restored. **To document an endpoint, write its
`@openapi` block next to the handler.** It ships with the route, it is
reviewed in the same diff, and it cannot fall out of step with the code it
sits beside.
