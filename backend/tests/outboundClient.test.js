// Unit/integration tests for the shared outbound client against local mock upstreams (no database).
const { startMock, json } = require('./helpers/mockUpstream');
const logger = require('../src/utils/logger');
const client = require('../src/outbound/client');
const { MemoryStore, CircuitBreaker } = require('../src/outbound/circuitBreaker');

let up;
const fastRetry = (o = {}) => ({ maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitter: 'none', ...o });
const newBreaker = () => new CircuitBreaker({ fallbackStore: new MemoryStore() });
const ok = (res) => json(res, 200, { ok: true });

beforeAll(async () => { up = await startMock((req, res) => ok(res)); });
afterAll(async () => { await up.close(); client.closeAgents(); });
beforeEach(() => { up.hits.length = 0; up.setHandler((req, res) => ok(res)); });

describe('outbound client: basics', () => {
  it('succeeds on the first attempt with no retries and propagates the correlation id', async () => {
    const r = await client.request({ url: `${up.url}/a?x=1`, correlationId: 'cid-123', breaker: false });
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(r.meta).toMatchObject({ attempts: 1, retries: 0, retryDelayMs: 0 });
    expect(up.hits[0].url).toBe('/a?x=1');
    expect(up.hits[0].headers['x-correlation-id']).toBe('cid-123');
    expect(up.hits[0].headers['accept-encoding']).toBe('identity');
  });

  it('reuses a pooled keep-alive connection for sequential requests', async () => {
    const ports = new Set();
    up.setHandler((req, res) => { ports.add(req.socket.remotePort); ok(res); });
    await client.request({ url: `${up.url}/1`, breaker: false });
    await client.request({ url: `${up.url}/2`, breaker: false });
    expect(ports.size).toBe(1);
  });

  it('streams a request body and enforces the request size limit', async () => {
    const { Readable } = require('stream');
    const big = Readable.from([Buffer.alloc(5000, 1), Buffer.alloc(5000, 1)]);
    await expect(client.request({ url: `${up.url}/up`, method: 'POST', body: big, limits: { maxRequestBytes: 6000 }, breaker: false }))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', statusCode: 413 });
    await expect(client.request({ url: `${up.url}/up`, method: 'POST', body: Buffer.alloc(100), limits: { maxRequestBytes: 10 }, breaker: false }))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});

describe('outbound client: timeouts and limits', () => {
  it('times out when response headers do not arrive (UPSTREAM_TIMEOUT / 504) and frees the socket', async () => {
    up.setHandler((req, res) => setTimeout(() => res.end('late'), 800));
    const t = Date.now();
    await expect(client.request({ url: `${up.url}/slow`, timeouts: { responseMs: 150 }, retry: { enabled: false }, breaker: false }))
      .rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT', statusCode: 504, category: 'upstream_timeout' });
    expect(Date.now() - t).toBeLessThan(600);
  });

  it('times out a stalled body (idle) even after headers were received', async () => {
    up.setHandler((req, res) => { res.writeHead(200, { 'content-length': '100' }); res.write('abc'); /* never finishes */ });
    await expect(client.request({ url: `${up.url}/stall`, timeouts: { responseMs: 1000, idleMs: 150 }, retry: { enabled: false }, breaker: false }))
      .rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  it('bounds a slow-drip body by the total deadline', async () => {
    up.setHandler((req, res) => {
      res.writeHead(200);
      const iv = setInterval(() => res.write('x'), 50);
      res.on('close', () => clearInterval(iv));
    });
    const t = Date.now();
    await expect(client.request({ url: `${up.url}/drip`, timeouts: { responseMs: 1000, idleMs: 1000, totalMs: 300 }, retry: { enabled: false }, breaker: false }))
      .rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    expect(Date.now() - t).toBeLessThan(900);
  });

  it('rejects oversized responses (declared and undeclared)', async () => {
    up.setHandler((req, res) => { res.writeHead(200, { 'content-length': '5000' }); res.end(Buffer.alloc(5000)); });
    await expect(client.request({ url: `${up.url}/big`, limits: { maxResponseBytes: 1024 }, breaker: false }))
      .rejects.toMatchObject({ code: 'UPSTREAM_RESPONSE_TOO_LARGE' });
    up.setHandler((req, res) => { res.writeHead(200); res.write(Buffer.alloc(3000)); res.end(Buffer.alloc(3000)); });
    await expect(client.request({ url: `${up.url}/chunked`, limits: { maxResponseBytes: 2048 }, breaker: false }))
      .rejects.toMatchObject({ code: 'UPSTREAM_RESPONSE_TOO_LARGE' });
  });

  it('reports a refused connection as UPSTREAM_UNREACHABLE without leaking the address', async () => {
    const closed = await startMock(ok); const port = closed.port; await closed.close();
    const err = await client.request({ url: `http://127.0.0.1:${port}/`, retry: { enabled: false }, breaker: false }).catch((e) => e);
    expect(err).toMatchObject({ code: 'UPSTREAM_UNREACHABLE', statusCode: 502 });
    expect(JSON.stringify({ message: err.message, details: err.details })).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
  });
});

describe('outbound client: cancellation', () => {
  it('aborts an in-flight request when the signal fires and does not retry', async () => {
    up.setHandler((req, res) => setTimeout(() => res.end('late'), 2000));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    const t = Date.now();
    const err = await client.request({ url: `${up.url}/x`, signal: ac.signal, retry: fastRetry(), breaker: false }).catch((e) => e);
    expect(err).toMatchObject({ code: 'REQUEST_CANCELLED', category: 'client_aborted' });
    expect(Date.now() - t).toBeLessThan(500);
    expect(up.hits.length).toBe(1);
  });

  it('cancels a pending retry backoff when the client disconnects', async () => {
    up.setHandler((req, res) => json(res, 503, { e: 1 }));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t = Date.now();
    const err = await client.request({ url: `${up.url}/x`, signal: ac.signal, retry: fastRetry({ baseDelayMs: 5000, maxDelayMs: 5000 }), breaker: false }).catch((e) => e);
    expect(err.code).toBe('REQUEST_CANCELLED');
    expect(Date.now() - t).toBeLessThan(1000);
    expect(up.hits.length).toBe(1); // second attempt never happened
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(client.request({ url: `${up.url}/x`, signal: ac.signal, breaker: false })).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(up.hits.length).toBe(0);
  });
});

describe('outbound client: retry with increasing backoff', () => {
  it('retries a transient 503 and succeeds, recording attempts and the delays slept', async () => {
    let n = 0;
    up.setHandler((req, res) => (++n < 3 ? json(res, 503, { e: 1 }) : ok(res)));
    const slept = [];
    const r = await client.request({ url: `${up.url}/r`, retry: fastRetry({ baseDelayMs: 100, maxDelayMs: 1000 }), breaker: false, sleep: async (ms) => { slept.push(ms); } });
    expect(r.status).toBe(200);
    expect(r.meta).toMatchObject({ attempts: 3, retries: 2, retryDelayMs: 300 });
    expect(slept).toEqual([100, 200]); // increasing
    expect(up.hits.length).toBe(3);
  });

  it('returns the last upstream response when retries are exhausted', async () => {
    up.setHandler((req, res) => json(res, 503, { e: 1 }));
    const r = await client.request({ url: `${up.url}/r`, retry: fastRetry({ maxAttempts: 3 }), breaker: false });
    expect(r.status).toBe(503);
    expect(r.meta.attempts).toBe(3);
    expect(up.hits.length).toBe(3);
  });

  it('retries repeated connection resets then gives up with a safe error', async () => {
    up.setHandler((req) => req.socket.destroy());
    const err = await client.request({ url: `${up.url}/r`, retry: fastRetry({ maxAttempts: 3 }), breaker: false }).catch((e) => e);
    expect(err).toMatchObject({ code: 'UPSTREAM_CONNECTION_RESET', statusCode: 502 });
    expect(err.meta.attempts).toBe(3);
  });

  it.each([400, 401, 403, 404, 422])('does not retry permanent %i responses', async (status) => {
    up.setHandler((req, res) => json(res, status, { e: 1 }));
    const r = await client.request({ url: `${up.url}/r`, retry: fastRetry(), breaker: false });
    expect(r.status).toBe(status);
    expect(up.hits.length).toBe(1);
  });

  it('does not blindly retry a non-idempotent POST on 503 or a mid-request reset', async () => {
    up.setHandler((req, res) => json(res, 503, { e: 1 }));
    const r = await client.request({ url: `${up.url}/p`, method: 'POST', body: '{}', retry: fastRetry(), breaker: false });
    expect(r.status).toBe(503);
    expect(up.hits.length).toBe(1);
    up.hits.length = 0;
    up.setHandler((req) => req.socket.destroy());
    await expect(client.request({ url: `${up.url}/p`, method: 'POST', body: '{}', retry: fastRetry(), breaker: false })).rejects.toMatchObject({ code: 'UPSTREAM_CONNECTION_RESET' });
    expect(up.hits.length).toBe(1);
  });

  it('retries a POST that carries an Idempotency-Key (and forwards the same key every time)', async () => {
    let n = 0;
    up.setHandler((req, res) => (++n < 2 ? json(res, 503, {}) : ok(res)));
    const r = await client.request({ url: `${up.url}/p`, method: 'POST', body: '{"a":1}', headers: { 'Idempotency-Key': 'key-1' }, retry: fastRetry(), breaker: false });
    expect(r.status).toBe(200);
    expect(up.hits.map((h) => h.headers['idempotency-key'])).toEqual(['key-1', 'key-1']);
    expect(up.hits.map((h) => h.body)).toEqual(['{"a":1}', '{"a":1}']);
  });

  it('retries a POST when the connection was refused (request provably never sent)', async () => {
    const closed = await startMock(ok); const port = closed.port; await closed.close();
    const err = await client.request({ url: `http://127.0.0.1:${port}/`, method: 'POST', body: '{}', retry: fastRetry({ maxAttempts: 3 }), breaker: false }).catch((e) => e);
    expect(err.code).toBe('UPSTREAM_UNREACHABLE');
    expect(err.meta.attempts).toBe(3);
  });

  it('respects Retry-After (seconds) when it is longer than the backoff', async () => {
    let n = 0;
    up.setHandler((req, res) => (++n < 2 ? json(res, 429, {}, { 'retry-after': '1' }) : ok(res)));
    const slept = [];
    const r = await client.request({ url: `${up.url}/r`, retry: fastRetry({ baseDelayMs: 10 }), breaker: false, sleep: async (ms) => { slept.push(ms); } });
    expect(r.status).toBe(200);
    expect(slept).toEqual([1000]);
  });

  it('does not wait for a Retry-After beyond the configured cap and returns the response instead', async () => {
    up.setHandler((req, res) => json(res, 503, {}, { 'retry-after': '3600' }));
    const r = await client.request({ url: `${up.url}/r`, retry: fastRetry({ maxRetryAfterMs: 2000 }), breaker: false });
    expect(r.status).toBe(503);
    expect(up.hits.length).toBe(1);
    expect(r.meta.attemptLog[0].stop).toBe('retry_after_too_long');
  });

  it('stops retrying at the total deadline and reports a timeout during retry', async () => {
    let n = 0;
    up.setHandler((req, res) => { if (++n === 1) return json(res, 503, {}); return setTimeout(() => ok(res), 2000); });
    const t = Date.now();
    const err = await client.request({
      url: `${up.url}/r`, retry: fastRetry({ baseDelayMs: 50, maxDelayMs: 50 }),
      timeouts: { responseMs: 1000, totalMs: 400 }, breaker: false,
    }).catch((e) => e);
    expect(err).toMatchObject({ code: 'UPSTREAM_TIMEOUT', statusCode: 504 });
    expect(err.meta.attempts).toBe(2);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('never waits past the deadline for a backoff pause', async () => {
    up.setHandler((req, res) => json(res, 503, {}));
    const r = await client.request({ url: `${up.url}/r`, retry: fastRetry({ baseDelayMs: 5000, maxDelayMs: 5000 }), timeouts: { totalMs: 500 }, breaker: false });
    expect(r.status).toBe(503);
    expect(r.meta.attempts).toBe(1);
    expect(r.meta.attemptLog[0].stop).toBe('deadline');
  });
});

describe('outbound client: circuit breaker integration', () => {
  it('opens after the threshold, rejects fast without touching the network, and stops retries', async () => {
    const breakerImpl = newBreaker();
    up.setHandler((req, res) => json(res, 503, {}));
    const opts = { url: `${up.url}/b`, breaker: { key: 'it-1', failureThreshold: 3, openMs: 60000 }, breakerImpl, retry: { enabled: false } };
    for (let i = 0; i < 3; i += 1) expect((await client.request(opts)).status).toBe(503);
    const before = up.hits.length;
    const err = await client.request(opts).catch((e) => e);
    expect(err).toMatchObject({ code: 'CIRCUIT_OPEN', statusCode: 503 });
    expect(Number(err.headers['Retry-After'])).toBeGreaterThan(0);
    expect(err.meta.circuitOpen).toBe(true);
    expect(up.hits.length).toBe(before);
  });

  it('a retrying request stops retrying the moment the circuit opens (no retry storm)', async () => {
    const breakerImpl = newBreaker();
    up.setHandler((req, res) => json(res, 503, {}));
    const err = await client.request({
      url: `${up.url}/b`, breakerImpl, breaker: { key: 'it-2', failureThreshold: 2, openMs: 60000 },
      retry: fastRetry({ maxAttempts: 10 }),
    }).catch((e) => e);
    expect(err.code).toBe('CIRCUIT_OPEN');
    expect(up.hits.length).toBe(2);
  });

  it('does not count 4xx (including 429) as infrastructure failures', async () => {
    const breakerImpl = newBreaker();
    up.setHandler((req, res) => json(res, 404, {}));
    const opts = { url: `${up.url}/b`, breaker: { key: 'it-3', failureThreshold: 2, openMs: 60000 }, breakerImpl, retry: { enabled: false } };
    for (let i = 0; i < 6; i += 1) expect((await client.request(opts)).status).toBe(404);
    up.setHandler((req, res) => json(res, 429, {}));
    for (let i = 0; i < 4; i += 1) expect((await client.request(opts)).status).toBe(429);
    expect((await breakerImpl.snapshot('it-3')).state).toBe('closed');
  });
});

describe('outbound client: SSRF, redirects and secret-safe logging', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'http://localhost:9/',
    'http://metadata.google.internal/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'ftp://example.com/', 'http://user:pw@example.com/',
  ])('refuses %s before any connection is attempted', async (url) => {
    await expect(client.request({ url, breaker: false })).rejects.toMatchObject({ code: 'UPSTREAM_ADDRESS_BLOCKED', statusCode: 502 });
  });

  it('does not follow redirects by default (the 3xx is returned as-is)', async () => {
    up.setHandler((req, res) => { res.writeHead(302, { location: '/other' }); res.end(); });
    const r = await client.request({ url: `${up.url}/r`, breaker: false });
    expect(r.status).toBe(302);
    expect(up.hits.length).toBe(1);
  });

  it('follows a safe redirect when allowed (GET only) and counts it as a redirect, not a retry', async () => {
    up.setHandler((req, res) => { if (req.url === '/r') { res.writeHead(302, { location: '/final' }); return res.end(); } return ok(res); });
    const r = await client.request({ url: `${up.url}/r`, maxRedirects: 3, breaker: false });
    expect(r.status).toBe(200);
    expect(r.meta).toMatchObject({ redirects: 1, attempts: 1, retries: 0 });
  });

  it('blocks a redirect to a private/metadata address even when redirects are allowed', async () => {
    up.setHandler((req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); res.end(); });
    await expect(client.request({ url: `${up.url}/r`, maxRedirects: 3, breaker: false })).rejects.toMatchObject({ code: 'UPSTREAM_REDIRECT_BLOCKED' });
    expect(up.hits.length).toBe(1);
  });

  it('never follows redirects for POST', async () => {
    up.setHandler((req, res) => { res.writeHead(307, { location: '/final' }); res.end(); });
    const r = await client.request({ url: `${up.url}/r`, method: 'POST', body: '{}', maxRedirects: 3, breaker: false });
    expect(r.status).toBe(307);
    expect(up.hits.length).toBe(1);
  });

  it('strips credentials when a redirect changes origin', async () => {
    const other = await startMock((req, res) => ok(res));
    up.setHandler((req, res) => { res.writeHead(302, { location: `${other.url}/landing` }); res.end(); });
    await client.request({ url: `${up.url}/r`, headers: { authorization: 'Bearer SECRET-TOKEN', 'x-api-key': 'SECRET-KEY' }, maxRedirects: 3, breaker: false });
    expect(up.hits[0].headers.authorization).toBe('Bearer SECRET-TOKEN');
    expect(other.hits[0].headers.authorization).toBeUndefined();
    expect(other.hits[0].headers['x-api-key']).toBeUndefined();
    await other.close();
  });

  it('never writes headers, bodies or credentials to the logs', async () => {
    const spies = ['warn', 'info', 'error', 'debug'].map((l) => jest.spyOn(logger, l).mockImplementation(() => {}));
    up.setHandler((req, res) => json(res, 503, {}));
    await client.request({
      url: `${up.url}/secret-path?token=QUERY-SECRET`, headers: { authorization: 'Bearer HEADER-SECRET' }, body: undefined,
      retry: fastRetry(), breaker: false,
    });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    expect(logged).toContain('outbound_retry');
    expect(logged).not.toMatch(/HEADER-SECRET|QUERY-SECRET/);
  });
});
