# BridgeX Phase 4 handoff

This bundle is based on the two Phase 4 ZIPs supplied in chat. It includes a small gateway correlation-ID correction: the gateway now returns and forwards `X-Correlation-ID` as well as `X-Request-Id`.

## API key setup (this is usually why a valid key appears not to work)

New keys intentionally have no gateway API grants. An ungranted key authenticates but receives `403 FORBIDDEN` when calling an API. Sign in as `SUPER_ADMIN` and:

1. Open **APIs & Services**. Configure the upstream URL, a gateway slug, allowed methods, and enable the gateway route.
2. Open **API Keys** and create a key. Copy the full key once; BridgeX stores only its hash and later displays only a preview.
3. Use the key's gear/settings action. Select the API under “APIs this key may call through the gateway”, then save.
4. Call `http://localhost:5000/gateway/<slug>/<upstream-path>` with `Authorization: Bearer <key>` (or `X-API-Key: <key>`).

A `401 INVALID_API_KEY` means the presented key is malformed, unknown, revoked, expired, or its owner is inactive. A `403 FORBIDDEN` means it is valid but has no grant for that API. Never send a real key in chat or commit it to source control.

## Windows PowerShell setup

Run each step from the relevant project directory. Copy the example environment files and edit the local copies; do not use production credentials for local tests.

```powershell
Set-Location .\backend
Copy-Item .env.example .env
notepad .env
npm ci
```

Set `DATABASE_URL` to your BridgeX PostgreSQL database, `JWT_SECRET` to a long random secret, and `GATEWAY_ENCRYPTION_KEY` to 64 hex characters (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). The encryption key must remain stable: changing it makes previously encrypted upstream credentials unreadable. For local frontend access set `CLIENT_URL=http://localhost:5173`.

### Safe database procedure

The supplied migration `005_idempotency.sql` only creates a new table/index with `IF NOT EXISTS`; it does not reset or recreate the database. Before applying it, confirm `DATABASE_URL` points to the intended database and take a backup:

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/bridgex'
pg_dump --format=custom --file .\bridgex-before-phase4.dump $env:DATABASE_URL
npm run migrate:phase4
```

Do not run that against an unknown production database. Tests must use a disposable isolated database configured as `TEST_DATABASE_URL`, and `NODE_ENV=test`; never aim test cleanup at your normal `bridgex` database.

### Run the app

```powershell
# backend terminal
Set-Location .\backend
npm run dev

# separate frontend terminal
Set-Location .\frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

Frontend production build: `npm run build`. API docs: `http://localhost:5000/api-docs`.

## Verification performed here

- Backend focused suites: 5 suites passed, 69 tests passed (gateway unit, Phase 4 HTTP, idempotency, cursor logs, structured logging).
- Full backend suite: 12 suites passed and 12 failed; 127 tests passed and 126 failed. Failures requiring PostgreSQL could not authenticate as the default `postgres` user.
- Frontend production build passed. Vite reported a large JavaScript chunk warning.
- Full backend regression is incomplete because PostgreSQL authentication failed for the supplied environment's default `postgres` user. No migrations were run and no database was modified.
- Dependency installation reported 13 backend and 12 frontend audit findings. These were not auto-fixed because broad dependency upgrades can introduce breaking changes.
- The Phase 3 audit report referenced in the pasted instruction was not included in the supplied files. The requirement checklist below maps the supplied Phase 4 request, rather than claiming to reproduce that missing report's exact 28 rows.

## Evidence checklist from the supplied request

| # | Requirement | Status |
|---|---|---|
| 1 | Known-resource 405 responses | COMPLETE |
| 2 | Correct `Allow` header | COMPLETE |
| 3 | Unknown routes remain 404 | COMPLETE |
| 4 | PUT full replacement / PATCH partial update | PARTIAL — schemas and routes exist; database regression suite unavailable |
| 5 | Idempotency-Key validation and scoping | COMPLETE |
| 6 | Persistent additive idempotency migration | COMPLETE |
| 7 | Idempotent replay and payload-conflict handling | COMPLETE |
| 8 | Concurrent idempotency reservation | PARTIAL — unique-constraint reservation exists; live PostgreSQL concurrency test unavailable |
| 9 | ETag and `If-None-Match` / 304 | COMPLETE |
| 10 | Safe JSON/XML negotiation and 406 | COMPLETE |
| 11 | Cursor log pagination / stable ordering | COMPLETE |
| 12 | Frontend Logs cursor integration | COMPLETE |
| 13 | Standard rate-limit errors and headers | PARTIAL — implementation exists; complete HTTP/DB integration coverage unavailable |
| 14 | Cache-Control policies | COMPLETE |
| 15 | OpenAPI coverage | COMPLETE — Redocly found no validation errors; 76 style/coverage warnings remain |
| 16 | Correlation ID validation and response header | COMPLETE |
| 17 | Gateway correlation ID response and upstream propagation | COMPLETE — corrected in this bundle |
| 18 | Structured secret-safe logging | PARTIAL — structured logging suite passes; full production-path suite unavailable |
| 19 | CORS policy and preflight | COMPLETE |
| 20 | PostgreSQL connection/query timeouts | COMPLETE |
| 21 | Safe migration application and data preservation | PARTIAL — additive migration verified by inspection; no database execution performed |
| 22 | API-key create/list/revoke management | PARTIAL — code exists; live DB tests blocked |
| 23 | Gateway key authentication | PARTIAL — code exists; needs configured DB and API grant to use |
| 24 | Gateway route and upstream setup | PARTIAL — code/UI exist; requires user-specific upstream settings |
| 25 | Gateway API grant workflow | COMPLETE — assign from API Keys → settings as SUPER_ADMIN |
| 26 | Backend focused automated tests | COMPLETE — 69 passed |
| 27 | Full existing backend regression suite | BLOCKED — 12 of 24 suites fail from unavailable PostgreSQL credentials/service |
| 28 | Frontend build and runtime setup | PARTIAL — production build passes; browser/runtime integration not exercised |

The system is not marked fully complete because the real PostgreSQL integration suite could not run successfully in this environment. Redocly did validate the OpenAPI document; its remaining 76 warnings are style or completeness findings.


