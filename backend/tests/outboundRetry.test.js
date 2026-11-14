const { resolvePolicy, backoffDelay, parseRetryAfter, evaluateRetry, isIdempotentRequest } = require('../src/outbound/retry');

describe('retry policy (pure)', () => {
  const none = resolvePolicy({ jitter: 'none', baseDelayMs: 100, maxDelayMs: 1000, maxAttempts: 4 });

  it('uses exponential backoff capped at maxDelay', () => {
    expect([1, 2, 3, 4, 5].map((a) => backoffDelay(a, none))).toEqual([100, 200, 400, 800, 1000]);
  });

  it('applies equal jitter within [ceiling/2, ceiling] and full jitter within [0, ceiling]', () => {
    const eq = resolvePolicy({ jitter: 'equal', baseDelayMs: 100, maxDelayMs: 1000 });
    expect(backoffDelay(3, eq, () => 0)).toBe(200);
    expect(backoffDelay(3, eq, () => 1)).toBe(400);
    const full = resolvePolicy({ jitter: 'full', baseDelayMs: 100, maxDelayMs: 1000 });
    expect(backoffDelay(3, full, () => 0)).toBe(0);
    expect(backoffDelay(3, full, () => 0.5)).toBe(200);
  });

  it('is bounded even with absurd configuration', () => {
    const p = resolvePolicy({ maxAttempts: 9999, baseDelayMs: 1e12, maxDelayMs: 1e12 });
    expect(p.maxAttempts).toBe(10);
    expect(backoffDelay(50, p, () => 1)).toBeLessThanOrEqual(120000);
  });

  it('parses Retry-After as seconds or HTTP date and ignores garbage', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(new Date(Date.now() + 4000).toUTCString())).toBeGreaterThan(2000);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it('treats GET/PUT/DELETE and requests with an Idempotency-Key as idempotent, plain POST/PATCH as not', () => {
    expect(isIdempotentRequest({ method: 'GET' })).toBe(true);
    expect(isIdempotentRequest({ method: 'DELETE' })).toBe(true);
    expect(isIdempotentRequest({ method: 'POST', headers: {} })).toBe(false);
    expect(isIdempotentRequest({ method: 'PATCH', headers: {} })).toBe(false);
    expect(isIdempotentRequest({ method: 'POST', headers: { 'Idempotency-Key': 'k1' } })).toBe(true);
    expect(isIdempotentRequest({ method: 'POST', idempotent: true })).toBe(true);
    expect(isIdempotentRequest({ method: 'GET', idempotent: false })).toBe(false);
  });

  const base = { attempt: 1, policy: none, method: 'GET', headers: {}, replayable: true };
  it('retries transient statuses for idempotent requests only', () => {
    expect(evaluateRetry({ ...base, status: 503 }).retry).toBe(true);
    expect(evaluateRetry({ ...base, status: 429 }).retry).toBe(true);
    expect(evaluateRetry({ ...base, status: 404 }).retry).toBe(false);
    expect(evaluateRetry({ ...base, status: 401 }).retry).toBe(false);
    expect(evaluateRetry({ ...base, status: 400 }).retry).toBe(false);
    expect(evaluateRetry({ ...base, method: 'POST', status: 503 })).toEqual({ retry: false, reason: 'non_idempotent_request' });
  });

  it('retries a POST only when the request provably never reached the upstream', () => {
    const refused = { retryable: true, notDelivered: true, category: 'upstream_refused' };
    const reset = { retryable: true, notDelivered: false, category: 'upstream_reset' };
    expect(evaluateRetry({ ...base, method: 'POST', err: refused }).retry).toBe(true);
    expect(evaluateRetry({ ...base, method: 'POST', err: reset }).retry).toBe(false);
    expect(evaluateRetry({ ...base, method: 'GET', err: reset }).retry).toBe(true);
  });

  it('never retries permanent errors, non-replayable bodies, or beyond maxAttempts', () => {
    expect(evaluateRetry({ ...base, err: { retryable: false, category: 'upstream_blocked' } }).retry).toBe(false);
    expect(evaluateRetry({ ...base, status: 503, replayable: false }).reason).toBe('body_not_replayable');
    expect(evaluateRetry({ ...base, attempt: 4, status: 503 }).reason).toBe('max_attempts');
  });
});
