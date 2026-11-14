# BridgeX — 28-item checklist after Phase 5: 26 / 28

Evidence = automated test (Jest + Supertest, real HTTP, real PostgreSQL/Redis, local mock upstreams) unless stated. Final run: **33 suites, 445 tests, 445 passed, 0 failed, 0 skipped** (run twice).

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Correct HTTP method per operation | ✅ Phase 4 (preserved) | existing suites pass |
| 2 | Idempotency key on POST | ✅ Phase 4 | existing suites pass |
| 3 | JSON Schema validation (AJV) | ✅ Phase 4 | existing suites; new schemas use the same AJV |
| 4 | Versioning under /v1 | ✅ Phase 4 | all new routes are under `/api/v1` |
| 5 | ≥ 8 distinct status codes | ✅ Phase 4 | existing suites |
| 6 | ETag and 304 | ✅ Phase 4 | existing suites |
| 7 | Content negotiation JSON/XML | ✅ Phase 4 | existing suites |
| 8 | Cursor pagination with next link | ✅ Phase 4 | existing suites |
| **9** | **One consistent error body everywhere** | ✅ **Phase 5** | `tests/unifiedErrors.test.js` (28): validation, auth, 404/405, bad JSON, 413/415, DB errors, rate limit, gateway, GraphQL, SOAP, CIRCUIT_OPEN; catalog ↔ OpenAPI enum checked. Upstream passthrough responses are intentionally unchanged (documented). |
| 10 | Cache-Control on every GET | ✅ Phase 4 | existing suites |
| **11** | **Resource-shaped URLs, no verbs** | ✅ **Phase 5** | `tests/resourceRoutes.test.js`: lint over every registered route; `PATCH /api-keys/:id`, `/auth/sessions`, `/auth/registrations`, `/integrations/:id/verifications`. 4 legacy verb aliases kept, marked deprecated (OpenAPI + Deprecation header on api-keys aliases). |
| 12 | Rate-limit headers and 429 | ✅ Phase 4 | existing suites |
| 13 | Hand-written OpenAPI | ✅ Phase 4 (+Phase 5 paths) | v1.1.0; `@apidevtools/swagger-parser` validate: VALID, 42 paths; `docs.test.js` compares spec ↔ routes |
| 14 | Swagger UI from own service | ✅ Phase 4 | existing suites |
| **15** | **Read a WSDL, make one real SOAP call** | ✅ **Phase 5** | `tests/soap.test.js` (23): WSDL + imported XSD read, Add(2,3)=5 over SOAP 1.1 and 1.2, headers, faults, hostile WSDLs (XXE, entity bomb, file/metadata/private/other-host import, redirect, huge), secrets. Real request/response in `backend/docs/SOAP.md`. Tested against a local SOAP service I wrote, not a public internet service. |
| **16** | **GraphQL endpoint alongside REST** | ✅ **Phase 5** | `tests/graphql.test.js` (21): queries, variables, operationName, mutations, errors, depth/complexity limits, forwarding to an external GraphQL upstream. Real request/response in `backend/docs/GRAPHQL.md`. |
| **17** | **Timeout on every outbound call** | ✅ **Phase 5** | shared client `src/outbound/client.js` used by gateway, verification, GraphQL, SOAP; `outboundClient.test.js` (45), `gatewayReliability.test.js`: 800 ms API timeout → 504 in 867 ms. |
| **18** | **Retry with increasing backoff** | ✅ **Phase 5** | `outboundRetry.test.js` (8), gateway test: 503,503,200 → attempts at 0/166/385 ms, 3 attempts logged. Safe-method/idempotency rules tested. |
| **19** | **Circuit breaker** | ✅ **Phase 5** | `circuitBreaker.test.js` (25, memory + real Redis, two instances sharing state, Redis-down fallback) and gateway/GraphQL/SOAP tests: CLOSED→OPEN after 5 failures, fail-fast `CIRCUIT_OPEN`, upstream not contacted. Distributed only when Redis is reachable; otherwise per-process (documented). |
| 20 | Express middleware + central error handler | ✅ Phase 4 (handler extended) | existing + new suites |
| 21 | Structured logging with correlation ID | ✅ Phase 4 (+retry/timeout/breaker/protocol fields) | `gatewayReliability.test.js` checks the log fields |
| 22 | SQL database, parameterized queries | ✅ Phase 4 | migration 006 additive |
| 23 | NoSQL document store | ✅ Phase 4 | MongoDB mocked in tests (see remaining issues) |
| 24 | JWT authn/authz | ✅ Phase 4 | role checks tested on every new route |
| 25 | CORS deliberate | ✅ Phase 4 | existing suites |
| **26** | **Jest + Supertest automated tests** | ✅ **Phase 5** | 33 suites / 445 tests passing, 0 skipped (baseline: 250 + 3 skipped). Frontend `vite build` OK. |
| 27 | Docker + twelve-factor config | ⏳ Phase 6 | not touched |
| 28 | Deployed and reachable on the internet | ⏳ Phase 6 | not done |
