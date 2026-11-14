# BridgeX — Phase 5 (complete project)

One folder, two apps:

```
BridgeX-Phase5/
  backend/     Express API  (http://localhost:5000)
  frontend/    React + Vite (http://localhost:5173)
  PHASE5-CHECKLIST.md   the 28-item checklist with evidence (26/28)
```
Unzip this ONE zip into an empty folder. Do not merge it into an older BridgeX-Phase4 folder.

## 0. Requirements
Node.js 18+, PostgreSQL 14+ (required). Redis (recommended; the circuit breaker shares state through it, otherwise it falls back to per-process memory). MongoDB (optional; request logs/analytics need it, the API still starts without it).

## 1. Backend
```bash
cd backend
npm install
cp .env.example .env            # Windows: copy .env.example .env
```
Edit `.env`:
* `DATABASE_URL` — your PostgreSQL URL (create the DB first: `createdb bridgex`)
* `JWT_SECRET` — any long random string
* `GATEWAY_ENCRYPTION_KEY` — 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
* `MONGO_URI`, `REDIS_URL` — if you run them
* `CLIENT_URL=http://localhost:5173` (CORS allows exactly this origin; open the frontend as **localhost**, not 127.0.0.1)

Database (first time only):
```bash
npm run migrate        # runs 001, 003, 004, 005, 006
node scripts/runSql.js migrations/002_seed.sql    # sample users/data (optional)
```
Already have the Phase 4 database? Run only the new, additive, re-runnable migration (read it first: `migrations/006_integration_protocols.sql`):
```bash
npm run migrate:phase5
```
Start:
```bash
npm start              # or: npm run dev
```
Check: http://localhost:5000/api/v1/health and Swagger UI http://localhost:5000/api-docs

## 2. Frontend
```bash
cd frontend
npm install
cp .env.example .env            # VITE_API_BASE_URL=http://localhost:5000/api/v1
npm run dev                     # http://localhost:5173
```
Production build: `npm run build` (output in `dist/`).
Seed login (if you ran the seed): `kartik@example.com` / `Password123!` (change it).

## 3. Verify Phase 5
```bash
cd backend && npm test          # Jest + Supertest: 33 suites, 445 tests
```
Tests need PostgreSQL (+ Redis for the Redis circuit-breaker tests). Point `DATABASE_URL`/`TEST_DATABASE_URL` at a **separate test database** (e.g. `bridgex_test`) and apply the migrations to it first — never run the tests against your development database.

Manual checks in the app:
1. **Integrations** → *New Integration* → pick REST / GraphQL / SOAP (SOAP asks for the WSDL URL) → *Test connection*. Status becomes **Connected** only after a real request succeeds; last-verified time and the last error are shown.
2. **Documentation** → error format, GraphQL, SOAP and reliability guides.
3. **Logs / Analytics** → protocol, retries, timeouts, circuit-breaker columns and the Reliability panel (need MongoDB).
4. **System Health** → Circuit Breakers panel (Super Admin) with Reset.
5. GraphQL: `POST http://localhost:5000/api/v1/graphql` with `Authorization: Bearer <token>` and `{"query":"{ health { status } me { email role } }"}`.

Local mock upstreams (HTTP on 127.0.0.1) are blocked by the SSRF guard. For local development only, allow one explicitly: `GATEWAY_DEV_ALLOWED_UPSTREAMS=127.0.0.1:PORT` in `.env` (ignored/refused in production).

## 4. Documentation
`backend/docs/GRAPHQL.md`, `SOAP.md`, `RELIABILITY.md` (real request/response captures, timeouts, retry, breaker, error body, URL changes), `backend/README.md`, `.env.example` (all new variables).

## Security notes
No `.env` is included. If the original `.env.example` password was ever real, rotate it. Integration credentials are encrypted at rest and never returned by the API.
