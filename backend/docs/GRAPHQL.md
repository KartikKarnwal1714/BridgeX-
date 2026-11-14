# GraphQL in BridgeX (checklist item 16)

BridgeX exposes a real GraphQL endpoint (graphql-js) next to REST: `POST /api/v1/graphql` (and `GET` for queries only).
It uses the same JWT authentication, role checks, validation schemas and services as REST.

## Schema

Queries: `health`, `me`, `apis(limit)`, `api(id)`, `integrations`, `integration(id)`, `apiKeys`, `circuitBreakers` (SUPER_ADMIN).
Mutations: `createIntegration`, `updateIntegration`, `deleteIntegration`, `verifyIntegration`, `revokeApiKey`.
Introspection is on by default (`GRAPHQL_INTROSPECTION=false` turns it off).

## Limits

Query depth (`GRAPHQL_MAX_DEPTH`, 8), complexity (`GRAPHQL_MAX_COMPLEXITY`, 500, alias/fragment aware, fragment cycles rejected),
query size and token count, execution timeout (`GRAPHQL_EXEC_TIMEOUT_MS`), per-user rate limit (`GRAPHQL_RATE_LIMIT_PER_MINUTE`). Batches (arrays) are refused. Mutations over GET are refused (405).

## Errors

* Problems before execution (syntax, validation, limits, auth) → HTTP 4xx, the unified error body **plus** a GraphQL `errors[]` array.
* Resolver errors → HTTP 200 and `errors[]` with `extensions.code` taken from the same error catalog as REST, and `extensions.correlationId`.

## Real request / response (captured from a running test, not hand-written)

```
POST /api/v1/graphql
{
  "query": "query Q($id: Int!) { me { email role } health { status service } apis(limit: 2) { id name protocol } api(id: $id) { id } }",
  "variables": {
    "id": 999999
  },
  "operationName": "Q"
}
```
```
HTTP 200
{
  "data": {
    "me": {
      "email": "kartik@example.com",
      "role": "SUPER_ADMIN"
    },
    "health": {
      "status": "healthy",
      "service": "BridgeX API"
    },
    "apis": [
      {
        "id": 128,
        "name": "Jest Test API",
        "protocol": "REST"
      },
      {
        "id": 65,
        "name": "Jest Test API",
        "protocol": "REST"
      }
    ],
    "api": null
  },
  "extensions": {
    "correlationId": "5e8a0dc4-5106-4fd6-9e7d-689001633dd3"
  }
}
```

Invalid query (`{ nope }`):
```
HTTP 400
{
  "success": false,
  "error": {
    "code": "GRAPHQL_VALIDATION_FAILED",
    "message": "The GraphQL document is not valid against the schema.",
    "details": [
      {
        "field": "(query)",
        "message": "Cannot query field \"nope\" on type \"Query\"."
      }
    ],
    "correlationId": "cdef1d7a-d32d-461f-98d1-86a114cb30b0"
  },
  "errors": [
    {
      "message": "Cannot query field \"nope\" on type \"Query\".",
      "extensions": {
        "code": "GRAPHQL_VALIDATION_FAILED",
        "correlationId": "cdef1d7a-d32d-461f-98d1-86a114cb30b0"
      }
    }
  ]
}
```

## Forwarding to an external GraphQL service

Register an integration with protocol GRAPHQL and call `POST /api/v1/integrations/:id/graphql` with `{query, variables, operationName}`.
The call goes through the shared outbound client (timeout, retry for queries, circuit breaker `integration:<id>`). Upstream non-2xx or non-JSON answers become
502 `GRAPHQL_UPSTREAM_ERRORS` / `UPSTREAM_INVALID_RESPONSE`.

Real forwarded call:
```
{
  "url": "/api/v1/integrations/128/graphql",
  "body": {
    "query": "query Q($x: Int){ echo(x:$x) }",
    "variables": {
      "x": 7
    },
    "operationName": "Q"
  }
}
→ upstream received: {"query": "query Q($x: Int){ echo(x:$x) }", "variables": {"x": 7}, "operationName": "Q"}
HTTP 200  {"data": {"echo": 7}}
```
