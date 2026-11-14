// Retry policy: pure functions (no I/O) so they can be unit-tested exhaustively.
const env = require('../config/env');

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE']);
const DEFAULT_RETRY_STATUSES = [408, 429, 502, 503, 504];

function defaultPolicy() {
  return {
    enabled: true,
    maxAttempts: env.RETRY_MAX_ATTEMPTS,
    baseDelayMs: env.RETRY_BASE_DELAY_MS,
    maxDelayMs: env.RETRY_MAX_DELAY_MS,
    jitter: env.RETRY_JITTER,
    maxRetryAfterMs: env.RETRY_MAX_RETRY_AFTER_MS,
    retryOnStatuses: DEFAULT_RETRY_STATUSES,
    // undefined = decide from the method / Idempotency-Key header; true/false overrides (e.g. a GraphQL
    // query is safe to retry even though it is sent with POST).
    idempotent: undefined,
  };
}

// Bounded no matter what a caller passes in.
function resolvePolicy(overrides = {}) {
  const base = defaultPolicy();
  const p = { ...base, ...stripUndefined(overrides) };
  p.maxAttempts = clamp(Math.trunc(p.maxAttempts), 1, 10);
  p.baseDelayMs = clamp(Math.trunc(p.baseDelayMs), 0, 60000);
  p.maxDelayMs = clamp(Math.trunc(p.maxDelayMs), 0, 120000);
  p.maxRetryAfterMs = clamp(Math.trunc(p.maxRetryAfterMs), 0, 300000);
  if (!['none', 'equal', 'full'].includes(p.jitter)) p.jitter = 'equal';
  if (p.enabled === false) p.maxAttempts = 1;
  return p;
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Delay before the NEXT attempt, after attempt number `attempt` (1-based) failed.
 *   ceiling = min(maxDelay, base * 2^(attempt-1))      -> 200, 400, 800, 1600 ... capped
 *   none:  ceiling               equal: ceiling/2 + rand*ceiling/2        full: rand*ceiling
 * "equal" (default) keeps every delay >= half the ceiling, so the sequence still increases while
 * different clients are spread apart (no synchronized retry storm).
 */
function backoffDelay(attempt, policy, random = Math.random) {
  const exp = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const ceiling = Math.min(policy.maxDelayMs, Number.isFinite(exp) ? exp : policy.maxDelayMs);
  if (policy.jitter === 'none') return Math.round(ceiling);
  if (policy.jitter === 'full') return Math.round(random() * ceiling);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/** Retry-After: delta-seconds or an HTTP date. Returns milliseconds, or null if absent/invalid. */
function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null) return null;
  const raw = String(Array.isArray(value) ? value[0] : value).trim();
  if (/^\d{1,9}$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

function hasIdempotencyKey(headers) {
  if (!headers) return false;
  return Object.keys(headers).some((k) => k.toLowerCase() === 'idempotency-key' && String(headers[k]).length > 0);
}

function isIdempotentRequest({ method, headers, idempotent }) {
  if (typeof idempotent === 'boolean') return idempotent;
  return IDEMPOTENT_METHODS.has(String(method).toUpperCase()) || hasIdempotencyKey(headers);
}

/**
 * Should another attempt be made? Returns { retry, reason }.
 *   - never beyond maxAttempts
 *   - never for permanent failures (auth, validation, blocked address, TLS, size limits, cancellation, 4xx)
 *   - a request that provably never reached the upstream (refused / DNS / connect timeout) is always safe
 *   - anything that may have been processed (reset, response timeout, 5xx) is retried only if the
 *     request is idempotent (method / Idempotency-Key / explicit override) and its body is replayable
 */
function evaluateRetry({ attempt, policy, method, headers, replayable, err, status }) {
  if (attempt >= policy.maxAttempts) return { retry: false, reason: 'max_attempts' };
  if (!replayable) return { retry: false, reason: 'body_not_replayable' };

  if (err) {
    if (!err.retryable) return { retry: false, reason: 'permanent_error' };
    if (err.notDelivered) return { retry: true, reason: err.category };
    return isIdempotentRequest({ method, headers, idempotent: policy.idempotent })
      ? { retry: true, reason: err.category }
      : { retry: false, reason: 'non_idempotent_request' };
  }
  if (!policy.retryOnStatuses.includes(status)) return { retry: false, reason: 'status_not_retryable' };
  return isIdempotentRequest({ method, headers, idempotent: policy.idempotent })
    ? { retry: true, reason: `status_${status}` }
    : { retry: false, reason: 'non_idempotent_request' };
}

module.exports = {
  resolvePolicy, backoffDelay, parseRetryAfter, evaluateRetry, isIdempotentRequest, hasIdempotencyKey,
  DEFAULT_RETRY_STATUSES, IDEMPOTENT_METHODS,
};
