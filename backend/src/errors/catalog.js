// Single source of truth for every machine-readable error code BridgeX itself can return, with the HTTP
// status it is paired with. The OpenAPI document, the unified-error tests and the error handlers all
// read this table, so a code cannot be invented in one place and forgotten in another.
//
// Scope: these are errors BridgeX GENERATES. When the gateway transparently proxies an upstream
// response (any status the upstream chose, including its own 4xx/5xx bodies), the upstream's status,
// headers and body are passed through unchanged - BridgeX cannot and does not rewrite them. Gateway
// responses that carry the `X-BridgeX-Error: true` header are BridgeX-generated and use this catalog.
const CATALOG = Object.freeze({
  // validation / request shape
  VALIDATION_ERROR: 400,
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  INVALID_PATH: 400,
  INVALID_CURSOR: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  NOT_ACCEPTABLE: 406,
  // authentication / authorization
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_API_KEY: 401,
  FORBIDDEN: 403,
  ACCOUNT_INACTIVE: 403,
  // not found / method
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  // conflicts
  CONFLICT: 409,
  EMAIL_IN_USE: 409,
  GATEWAY_ROUTE_CONFLICT: 409,
  CANNOT_DELETE_SELF: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  // rate limiting
  RATE_LIMITED: 429,
  RATE_LIMIT_EXCEEDED: 429,
  TOO_MANY_FAILED_ATTEMPTS: 429,
  // GraphQL
  GRAPHQL_PARSE_FAILED: 400,
  GRAPHQL_VALIDATION_FAILED: 400,
  GRAPHQL_QUERY_TOO_COMPLEX: 400,
  GRAPHQL_QUERY_TOO_DEEP: 400,
  GRAPHQL_INTROSPECTION_DISABLED: 400,
  GRAPHQL_MUTATION_OVER_GET: 405,
  GRAPHQL_UPSTREAM_ERRORS: 502,
  GRAPHQL_EXECUTION_TIMEOUT: 504,
  // SOAP / WSDL
  SOAP_FAULT: 502,
  SOAP_INVALID_WSDL: 502,
  SOAP_UNKNOWN_OPERATION: 400,
  SOAP_INVALID_RESPONSE: 502,
  INTEGRATION_NOT_CONFIGURED: 409,
  INTEGRATION_PROTOCOL_MISMATCH: 409,
  // upstream failures (outbound client)
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_UNREACHABLE: 502,
  UPSTREAM_DNS_FAILURE: 502,
  UPSTREAM_CONNECTION_RESET: 502,
  UPSTREAM_TLS_ERROR: 502,
  UPSTREAM_INVALID_RESPONSE: 502,
  UPSTREAM_ADDRESS_BLOCKED: 502,
  UPSTREAM_RESPONSE_TOO_LARGE: 502,
  UPSTREAM_ERROR: 502,
  UPSTREAM_REDIRECT_BLOCKED: 502,
  CIRCUIT_OPEN: 503,
  REQUEST_CANCELLED: 499,
  // availability / server
  SERVICE_UNAVAILABLE: 503,
  SERVICE_DISABLED: 503,
  NOT_READY: 503,
  LOG_STORE_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
  DATABASE_TIMEOUT: 503,
  DATABASE_MIGRATION_REQUIRED: 503,
  GATEWAY_MISCONFIGURED: 500,
  INTERNAL_SERVER_ERROR: 500,
});

function isKnownCode(code) {
  return Object.prototype.hasOwnProperty.call(CATALOG, code);
}

module.exports = { CATALOG, isKnownCode };
