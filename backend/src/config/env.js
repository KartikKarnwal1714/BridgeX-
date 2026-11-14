const path = require('path');
// BRIDGEX_SKIP_DOTENV=1 lets a caller (the test-suite's child processes) start with a clean, explicit
// environment instead of inheriting whatever is in the developer's local .env. Normal runs are unaffected.
if (process.env.BRIDGEX_SKIP_DOTENV !== '1') {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
}

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  return value;
}

const env = {
  NODE_ENV: required('NODE_ENV', 'development'),
  PORT: parseInt(required('PORT', '5000'), 10),

  DATABASE_URL: required(
    'DATABASE_URL',
    'postgresql://postgres:postgres@localhost:5432/bridgex'
  ),
  PG_CONNECTION_TIMEOUT_MS: intEnv('PG_CONNECTION_TIMEOUT_MS', 5000, 100, 60000),
  PG_STATEMENT_TIMEOUT_MS: intEnv('PG_STATEMENT_TIMEOUT_MS', 15000, 100, 300000),
  PG_QUERY_TIMEOUT_MS: intEnv('PG_QUERY_TIMEOUT_MS', 20000, 100, 300000),
  PG_IDLE_TX_TIMEOUT_MS: intEnv('PG_IDLE_TX_TIMEOUT_MS', 15000, 100, 300000),

  MONGO_URI: required('MONGO_URI', 'mongodb://localhost:27017/bridgex_logs'),

  REDIS_URL: required('REDIS_URL', 'redis://localhost:6379'),

  JWT_SECRET: required('JWT_SECRET', 'dev-secret-change-me'),
  JWT_EXPIRES_IN: required('JWT_EXPIRES_IN', '1h'),

  CLIENT_URL: required('CLIENT_URL', 'http://localhost:5173'),

  BCRYPT_SALT_ROUNDS: parseInt(required('BCRYPT_SALT_ROUNDS', '10'), 10),

  // How long request logs are kept in MongoDB before automatic deletion.
  LOG_RETENTION_DAYS: Math.max(1, parseInt(required('LOG_RETENTION_DAYS', '30'), 10) || 30),

  // ---- API gateway (Phase 3) ----
  GATEWAY_MAX_BODY_BYTES: intEnv('GATEWAY_MAX_BODY_BYTES', 1024 * 1024, 1024, 100 * 1024 * 1024),
  // When the gateway rejects an oversized upload it first discards (never stores) up to this many more bytes, for at
  // most this long, so the client reliably receives the 413 instead of a connection reset. Beyond either, it just closes.
  GATEWAY_REJECT_DRAIN_MAX_BYTES: intEnv('GATEWAY_REJECT_DRAIN_MAX_BYTES', 16 * 1024 * 1024, 0, 256 * 1024 * 1024),
  GATEWAY_REJECT_DRAIN_TIMEOUT_MS: intEnv('GATEWAY_REJECT_DRAIN_TIMEOUT_MS', 5000, 100, 60000),
  GATEWAY_MAX_RESPONSE_BYTES: intEnv('GATEWAY_MAX_RESPONSE_BYTES', 10 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
  GATEWAY_MAX_TIMEOUT_MS: intEnv('GATEWAY_MAX_TIMEOUT_MS', 30000, 100, 60000),
  GATEWAY_DEFAULT_TIMEOUT_MS: intEnv('GATEWAY_DEFAULT_TIMEOUT_MS', 10000, 100, 60000),
  // Fixed rate-limit window. 60s means "rate_limit_per_minute" is literal; shorter values exist for tests.
  GATEWAY_RATE_WINDOW_MS: intEnv('GATEWAY_RATE_WINDOW_MS', 60000, 1000, 3600000),

  // ---- Shared outbound HTTP client (Phase 5). Every outbound call is bounded by these. ----
  // Time allowed to establish the TCP (+TLS) connection.
  OUTBOUND_CONNECT_TIMEOUT_MS: intEnv('OUTBOUND_CONNECT_TIMEOUT_MS', 5000, 100, 60000),
  // Time allowed from sending the request until the response headers arrive (per attempt).
  OUTBOUND_RESPONSE_TIMEOUT_MS: intEnv('OUTBOUND_RESPONSE_TIMEOUT_MS', 10000, 100, 120000),
  // Hard deadline for the whole call including every retry and backoff pause.
  OUTBOUND_TOTAL_TIMEOUT_MS: intEnv('OUTBOUND_TOTAL_TIMEOUT_MS', 30000, 100, 300000),
  // Max silence between body chunks once a response has started.
  OUTBOUND_IDLE_TIMEOUT_MS: intEnv('OUTBOUND_IDLE_TIMEOUT_MS', 10000, 100, 120000),
  OUTBOUND_MAX_REQUEST_BYTES: intEnv('OUTBOUND_MAX_REQUEST_BYTES', 1024 * 1024, 1024, 100 * 1024 * 1024),
  OUTBOUND_MAX_RESPONSE_BYTES: intEnv('OUTBOUND_MAX_RESPONSE_BYTES', 5 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
  OUTBOUND_MAX_SOCKETS: intEnv('OUTBOUND_MAX_SOCKETS', 64, 1, 1024),
  OUTBOUND_MAX_FREE_SOCKETS: intEnv('OUTBOUND_MAX_FREE_SOCKETS', 16, 0, 256),
  OUTBOUND_KEEP_ALIVE: boolEnv('OUTBOUND_KEEP_ALIVE', true),
  OUTBOUND_MAX_REDIRECTS: intEnv('OUTBOUND_MAX_REDIRECTS', 3, 0, 10),

  // Gateway pass-through retries: only requests without a body (GET/HEAD/DELETE...) that are idempotent,
  // and only for 502/503/504 or connection-level failures. Set false to disable gateway retries entirely.
  GATEWAY_RETRY_ENABLED: boolEnv('GATEWAY_RETRY_ENABLED', true),

  // ---- Retry with exponential backoff + jitter ----
  RETRY_MAX_ATTEMPTS: intEnv('RETRY_MAX_ATTEMPTS', 3, 1, 10), // total attempts, including the first
  RETRY_BASE_DELAY_MS: intEnv('RETRY_BASE_DELAY_MS', 200, 1, 60000),
  RETRY_MAX_DELAY_MS: intEnv('RETRY_MAX_DELAY_MS', 5000, 1, 120000),
  RETRY_JITTER: ['none', 'equal', 'full'].includes(process.env.RETRY_JITTER) ? process.env.RETRY_JITTER : 'equal',
  // A Retry-After longer than this is not waited for: the response is returned to the caller instead.
  RETRY_MAX_RETRY_AFTER_MS: intEnv('RETRY_MAX_RETRY_AFTER_MS', 10000, 0, 300000),

  // ---- Circuit breaker ----
  BREAKER_ENABLED: boolEnv('BREAKER_ENABLED', true),
  BREAKER_FAILURE_THRESHOLD: intEnv('BREAKER_FAILURE_THRESHOLD', 5, 1, 1000),
  BREAKER_OPEN_MS: intEnv('BREAKER_OPEN_MS', 30000, 10, 3600000),
  BREAKER_HALF_OPEN_MAX_PROBES: intEnv('BREAKER_HALF_OPEN_MAX_PROBES', 1, 1, 100),
  BREAKER_SUCCESS_THRESHOLD: intEnv('BREAKER_SUCCESS_THRESHOLD', 2, 1, 100),
  // 'redis' shares breaker state between BridgeX instances (falls back to local memory if Redis is down);
  // 'memory' keeps state per process.
  BREAKER_STORE: process.env.BREAKER_STORE === 'memory' ? 'memory' : 'redis',

  // ---- GraphQL ----
  GRAPHQL_MAX_DEPTH: intEnv('GRAPHQL_MAX_DEPTH', 8, 1, 50),
  GRAPHQL_MAX_COMPLEXITY: intEnv('GRAPHQL_MAX_COMPLEXITY', 500, 1, 100000),
  GRAPHQL_MAX_QUERY_BYTES: intEnv('GRAPHQL_MAX_QUERY_BYTES', 20000, 100, 1024 * 1024),
  GRAPHQL_EXEC_TIMEOUT_MS: intEnv('GRAPHQL_EXEC_TIMEOUT_MS', 10000, 100, 120000),
  GRAPHQL_RATE_LIMIT_PER_MINUTE: intEnv('GRAPHQL_RATE_LIMIT_PER_MINUTE', 120, 1, 100000),
  GRAPHQL_INTROSPECTION: process.env.GRAPHQL_INTROSPECTION
    ? process.env.GRAPHQL_INTROSPECTION === 'true'
    : process.env.NODE_ENV !== 'production',

  // ---- SOAP / WSDL ----
  SOAP_WSDL_MAX_BYTES: intEnv('SOAP_WSDL_MAX_BYTES', 2 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  SOAP_WSDL_MAX_IMPORTS: intEnv('SOAP_WSDL_MAX_IMPORTS', 10, 0, 100),
  SOAP_WSDL_CACHE_TTL_MS: intEnv('SOAP_WSDL_CACHE_TTL_MS', 300000, 0, 86400000),
  SOAP_MAX_RESPONSE_BYTES: intEnv('SOAP_MAX_RESPONSE_BYTES', 2 * 1024 * 1024, 1024, 100 * 1024 * 1024),
};

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(v).toLowerCase());
}

function intEnv(name, fallback, min, max) {
  const n = parseInt(process.env[name] ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Key used to encrypt upstream credentials at rest (AES-256-GCM, 32 bytes = 64 hex chars).
// Production must supply its own; in development/test one is derived from JWT_SECRET so
// the project works out of the box (never rely on that outside local use).
function resolveEncryptionKey() {
  const provided = process.env.GATEWAY_ENCRYPTION_KEY;
  if (provided) {
    if (!/^[a-fA-F0-9]{64}$/.test(provided)) {
      throw new Error('GATEWAY_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return provided.toLowerCase();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('GATEWAY_ENCRYPTION_KEY must be set in production');
  }
  return require('crypto').createHash('sha256').update(`bridgex-gateway:${env.JWT_SECRET}`).digest('hex');
}

// Development-only escape hatch: "host:port" pairs of LOCAL test upstreams that may bypass the
// private-address block. Read at call time (tests set it after starting a mock server).
// It does nothing — and refuses to even load — in production.
env.devAllowedUpstreams = function devAllowedUpstreams() {
  if (env.NODE_ENV === 'production') return [];
  return (process.env.GATEWAY_DEV_ALLOWED_UPSTREAMS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
};

if (env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL) {
  // Lets the test suite run against a separate database so tests never
  // touch your development data.
  env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (
  env.NODE_ENV === 'production' &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me' || process.env.JWT_SECRET.length < 32)
) {
  throw new Error('JWT_SECRET must be set to a strong value (32+ characters) in production');
}

if (env.NODE_ENV === 'production' && process.env.GATEWAY_DEV_ALLOWED_UPSTREAMS) {
  throw new Error('GATEWAY_DEV_ALLOWED_UPSTREAMS must not be set in production');
}

env.GATEWAY_ENCRYPTION_KEY = resolveEncryptionKey();

module.exports = env;
