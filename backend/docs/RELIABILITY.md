# Reliability: timeout, retry, circuit breaker, errors (checklist items 9, 17, 18, 19)

All outbound calls (gateway proxy, REST verification, GraphQL forwarding, SOAP) use one client: `src/outbound/client.js`.

## Timeouts (17)
Connect / response / idle / total deadline (`OUTBOUND_*`), request and response size limits, cancellation when the client disconnects. The gateway's total budget is the API's `timeout_ms`.

Real result: API timeout 800 ms against a hanging upstream → 504 after 867 ms.
```
{
  "success": false,
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "The upstream service did not respond in time",
    "details": [],
    "correlationId": "621314e6-b5de-4df9-a54e-e3f2d625303c"
  },
  "requestId": "621314e6-b5de-4df9-a54e-e3f2d625303c"
}
log: {"protocol": "REST", "attempts": 1, "retries": 0, "retryDelayMs": 0, "timedOut": true, "breakerState": "closed", "circuitOpen": false, "outcome": "gateway_error"}
```

## Retry with backoff (18)
delay = min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS · 2^(n-1)) with jitter (`RETRY_JITTER`: none|equal|full); `Retry-After` honoured (capped). Only transient failures (timeouts, connection errors, 408/429/502/503/504).
The **gateway** retries only 502/503/504 on bodyless (replayable) requests; POST is not retried there. Library callers retry a POST only when it provably never reached the upstream, carries an Idempotency-Key, or is marked idempotent.

Real result (upstream answers 503, 503, 200): attempts at [0, 166, 385] ms, gaps [166, 219] ms, client got 200; log: {"protocol": "REST", "attempts": 3, "retries": 2, "retryDelayMs": 382, "timedOut": false, "breakerState": "closed", "circuitOpen": false, "outcome": "success"}

## Circuit breaker (19)
CLOSED → OPEN after `BREAKER_FAILURE_THRESHOLD` consecutive failures (timeouts, connection/TLS errors, HTTP 500/502/503/504; 4xx never count); OPEN fails fast with 503 `CIRCUIT_OPEN` + `Retry-After`;
after `BREAKER_OPEN_MS` HALF_OPEN lets `BREAKER_HALF_OPEN_MAX_PROBES` probe(s) through; `BREAKER_SUCCESS_THRESHOLD` successes close it, a failure re-opens it. Breakers are per upstream (`api:<id>`, `integration:<id>`).

**Distributed or not:** with `BREAKER_STORE=redis` the state lives in Redis (atomic Lua scripts, Redis clock) and is shared by all instances. If Redis is unreachable or slow (>250 ms) an instance falls back to its own memory; in that mode the state is **not** shared. `GET /system-health/circuit-breakers` (SUPER_ADMIN) shows the mode.

Real sequence (upstream always 500): [{"call": 1, "status": 500, "breaker": "closed", "upstreamHits": 1}, {"call": 2, "status": 500, "breaker": "closed", "upstreamHits": 2}, {"call": 3, "status": 500, "breaker": "closed", "upstreamHits": 3}, {"call": 4, "status": 500, "breaker": "closed", "upstreamHits": 4}, {"call": 5, "status": 500, "breaker": "open", "upstreamHits": 5}, {"call": 6, "status": 503, "breaker": "open", "upstreamHits": 5}]
When open: upstream untouched = True
```
{
  "success": false,
  "error": {
    "code": "CIRCUIT_OPEN",
    "message": "The upstream service is temporarily unavailable. Please retry later.",
    "details": [],
    "correlationId": "4a8eb105-b205-4241-93c7-84a8a336d899"
  },
  "requestId": "4a8eb105-b205-4241-93c7-84a8a336d899"
}
```

## Unified error body (9)
`{"success":false,"error":{"code","message","details":[],"correlationId"}}` for every error BridgeX generates (validation, auth, JSON parse, 404, 413/415, DB, rate limit, gateway, GraphQL transport, SOAP, circuit open...). Codes are listed in `src/errors/catalog.js` and the OpenAPI `ErrorCode` enum.
**Passthrough:** responses of a proxied upstream are forwarded unchanged; BridgeX does not control their format. Errors created by the gateway carry `X-BridgeX-Error: true`.

Real samples:
```
{
  "validation": {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Invalid request",
      "details": [
        {
          "field": "type",
          "message": "must have required property 'type'"
        },
        {
          "field": "protocol",
          "message": "must have required property 'protocol'"
        },
        {
          "field": "endpoint",
          "message": "must have required property 'endpoint'"
        },
        {
          "field": "/name",
          "message": "must NOT have fewer than 2 characters"
        }
      ],
      "correlationId": "9ccee89a-ef0f-4073-aacc-d8402c5c1321"
    }
  },
  "unauthorized": {
    "success": false,
    "error": {
      "code": "UNAUTHORIZED",
      "message": "Missing or malformed Authorization header",
      "details": [],
      "correlationId": "d26f7161-0d01-47f7-90b7-0961b4e86040"
    }
  },
  "notFound": {
    "success": false,
    "error": {
      "code": "NOT_FOUND",
      "message": "API not found",
      "details": [],
      "correlationId": "ad2563ae-4ef9-4597-8b5a-cc2484231bec"
    }
  },
  "badJson": {
    "success": false,
    "error": {
      "code": "INVALID_JSON",
      "message": "Request body is not valid JSON",
      "details": [],
      "correlationId": "f99d66f7-759a-4f95-b364-9bbb96fd3090"
    }
  },
  "gatewayNoKey": {
    "success": false,
    "error": {
      "code": "UNAUTHORIZED",
      "message": "An API key is required (Authorization: Bearer <key> or X-API-Key)",
      "details": [],
      "correlationId": "1e2c452e-f378-48c7-9905-4d81d1592c5f"
    },
    "requestId": "1e2c452e-f378-48c7-9905-4d81d1592c5f"
  }
}
```

## Resource URLs (11)
Verb routes were replaced: `PATCH /api-keys/:id` (status/gateway settings), `POST /auth/sessions`, `GET /auth/sessions/current`, `POST /auth/registrations`, `POST /integrations/:id/verifications`.
Old routes (`/auth/login`, `/auth/register`, `/api-keys/:id/revoke`, `/api-keys/:id/gateway`) remain as DEPRECATED aliases for Phase 4 clients and are flagged in OpenAPI; a test fails if any other verb route appears.

## Migration 006 (additive, idempotent)
`migrations/006_integration_protocols.sql` adds nullable/defaulted columns to `integrations` (config, auth_mode, auth_header, credential_enc, timeout_ms, last_verified_at, last_verification_*). Run `npm run migrate:phase5`; rollback: `006_integration_protocols.down.sql`. It does not touch existing rows' data. Applied to the **test** database only in this work.
