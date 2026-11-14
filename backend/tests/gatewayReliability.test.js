// Checklist items 17, 18, 19 on the REAL gateway path: timeout, retry with backoff, circuit breaker,
// cancellation, and the reliability fields written to the request log.
const logDocs = [];
jest.mock('../src/models/logModel', () => ({
  create: jest.fn(async (d) => { logDocs.push(d); return d; }), find: jest.fn(), findById: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(),
}));
jest.mock('../src/config/mongo', () => ({
  isMongoConnected: () => true, connectMongo: jest.fn(),
  mongoose: { isValidObjectId: () => true, connection: { db: { admin: () => ({ ping: async () => {} }) } } },
}));
const http = require('http');
const { request } = require('./helpers');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { startMock, json } = require('./helpers/mockUpstream');
const { bearer, tokens } = require('./helpers/phase5');
const rateLimiter = require('../src/gateway/rateLimiter');
const { breaker } = require('../src/outbound/circuitBreaker');

let server; let t; let up; let gwKey; let gwKeyId; const made = [];
async function makeApi(over = {}) {
  const res = await request(server).post('/api/v1/apis').set(bearer(t.admin)).send({
    name: `GR ${Math.random().toString(36).slice(2, 7)}`, protocol: 'REST', base_url: up.url, gateway_slug: `gr-${Math.random().toString(36).slice(2, 9)}`, gateway_enabled: true, ...over,
  });
  made.push(res.body.data.id);
  await request(server).patch(`/api/v1/api-keys/${gwKeyId}`).set(bearer(t.admin)).send({ apiIds: [...made] });
  return res.body.data;
}
const gw = (slug, p = '/x', method = 'get') => request(server)[method](`/gateway/${slug}${p}`).set('Authorization', `Bearer ${gwKey}`);
const lastLog = async () => { await new Promise((r) => setTimeout(r, 50)); return logDocs[logDocs.length - 1]; };

beforeAll(async () => {
  up = await startMock((req, res) => json(res, 200, { ok: true }));
  server = http.createServer(app).listen(0);
  t = await tokens(server);
  const k = await request(server).post('/api/v1/api-keys').set(bearer(t.admin)).send({ name: 'GR key', environment: 'Test' });
  gwKey = k.body.data.key; gwKeyId = k.body.data.id;
});
beforeEach(() => { rateLimiter._resetMemoryForTests(); up.hits.length = 0; logDocs.length = 0; up.setHandler((req, res) => json(res, 200, { ok: true })); });
afterAll(async () => {
  await pool.query('DELETE FROM api_keys WHERE id = $1', [gwKeyId]);
  await pool.query('DELETE FROM apis WHERE id = ANY($1::int[])', [made]);
  await up.close(); server.close(); await pool.end();
});

describe('timeout (item 17)', () => {
  it('a hanging upstream is cut off at the API timeout → 504 GATEWAY_TIMEOUT-style error, with the timeout logged', async () => {
    const api = await makeApi({ timeout_ms: 800 });
    up.setHandler(() => {});
    const started = Date.now();
    const res = await gw(api.gateway_slug);
    const took = Date.now() - started;
    expect(res.status).toBe(504);
    expect(res.headers['x-bridgex-error']).toBe('true');
    expect(res.body.success).toBe(false);
    expect(took).toBeGreaterThanOrEqual(700);
    expect(took).toBeLessThan(2500); // total deadline holds even though retries are enabled
    const log = await lastLog();
    expect(log.timedOut).toBe(true);
    expect(log.protocol).toBe('REST');
  }, 15000);
  it('a slow-but-in-time upstream is not cut off', async () => {
    const api = await makeApi({ timeout_ms: 3000 });
    up.setHandler((req, res) => setTimeout(() => json(res, 200, { slow: true }), 300));
    const res = await gw(api.gateway_slug);
    expect(res.status).toBe(200);
  });
});

describe('retry with backoff (item 18)', () => {
  it('GET is retried on 503 and succeeds, retries are logged', async () => {
    const api = await makeApi({ timeout_ms: 5000 });
    let n = 0;
    up.setHandler((req, res) => { n += 1; if (n <= 2) return json(res, 503, { busy: true }); return json(res, 200, { ok: true }); });
    const res = await gw(api.gateway_slug);
    expect(res.status).toBe(200);
    expect(up.hits.length).toBe(3);
    const gaps = up.hits.slice(1).map((h, i) => h.at - up.hits[i].at);
    expect(gaps[1]).toBeGreaterThan(gaps[0] * 0.9); // backoff does not shrink between attempts
    const log = await lastLog();
    expect(log.attempts).toBe(3);
    expect(log.retries).toBe(2);
    expect(log.retryDelayMs).toBeGreaterThan(0);
  });
  it('a persistent 503 is passed through after the attempts are exhausted (upstream response is not rewritten)', async () => {
    const api = await makeApi({ timeout_ms: 8000 });
    up.setHandler((req, res) => json(res, 503, { upstream: 'busy' }));
    const res = await gw(api.gateway_slug);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ upstream: 'busy' }); // passthrough: BridgeX does not control upstream bodies
    expect(res.headers['x-bridgex-error']).toBeUndefined();
    expect(up.hits.length).toBe(3);
  });
  it('4xx from the upstream is never retried', async () => {
    const api = await makeApi();
    up.setHandler((req, res) => json(res, 404, { nope: 1 }));
    const res = await gw(api.gateway_slug);
    expect(res.status).toBe(404);
    expect(up.hits.length).toBe(1);
  });
  it('POST is never retried by the gateway (not safe to replay)', async () => {
    const api = await makeApi();
    up.setHandler((req, res) => json(res, 503, {}));
    const res = await gw(api.gateway_slug, '/x', 'post').send({ a: 1 });
    expect(res.status).toBe(503);
    expect(up.hits.length).toBe(1);
  });
});

describe('circuit breaker (item 19)', () => {
  it('opens after repeated upstream failures, fails fast with CIRCUIT_OPEN, then recovers through HALF_OPEN', async () => {
    const api = await makeApi({ timeout_ms: 3000 });
    const key = `api:${api.id}`;
    breaker.reset(key);
    up.setHandler((req, res) => json(res, 500, { boom: 1 }));
    for (let i = 0; i < 6; i += 1) await gw(api.gateway_slug);
    expect((await breaker.snapshot(key)).state).toBe('open');
    const hitsBefore = up.hits.length;
    const blocked = await gw(api.gateway_slug);
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('CIRCUIT_OPEN');
    expect(blocked.headers['x-bridgex-error']).toBe('true');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(up.hits.length).toBe(hitsBefore);
    const log = await lastLog();
    expect(log.circuitOpen).toBe(true);
    expect(log.breakerState).toBe('open');
    // Admin can inspect and reset
    const list = await request(server).get('/api/v1/system-health/circuit-breakers').set(bearer(t.admin));
    expect(list.body.data.circuits.some((b) => b.key === key && b.state === 'open')).toBe(true);
    const reset = await request(server).delete(`/api/v1/system-health/circuit-breakers/${encodeURIComponent(key)}`).set(bearer(t.admin));
    expect(reset.status).toBe(204);
    up.setHandler((req, res) => json(res, 200, { ok: true }));
    expect((await gw(api.gateway_slug)).status).toBe(200);
  }, 30000);
  it('only SUPER_ADMIN can see or reset breakers', async () => {
    expect((await request(server).get('/api/v1/system-health/circuit-breakers').set(bearer(t.viewer))).status).toBe(403);
    expect((await request(server).delete('/api/v1/system-health/circuit-breakers/x').set(bearer(t.developer))).status).toBe(403);
  });
  it('one API failing does not open another API’s circuit', async () => {
    const bad = await makeApi(); const good = await makeApi();
    breaker.reset(`api:${bad.id}`); breaker.reset(`api:${good.id}`);
    up.setHandler((req, res) => json(res, req.url.startsWith('/bad') ? 500 : 200, {}));
    for (let i = 0; i < 6; i += 1) await gw(bad.gateway_slug, '/bad');
    expect((await gw(good.gateway_slug, '/ok')).status).toBe(200);
  }, 30000);
});

describe('cancellation', () => {
  it('when the client disconnects the upstream request is aborted', async () => {
    const api = await makeApi({ timeout_ms: 10000 });
    let upstreamClosed = false;
    up.setHandler((req) => { req.on('close', () => { upstreamClosed = true; }); });
    await new Promise((resolve) => {
      const addr = server.address();
      const r = http.get({ port: addr.port, path: `/gateway/${api.gateway_slug}/hang`, headers: { Authorization: `Bearer ${gwKey}` } });
      r.on('error', () => {});
      setTimeout(() => { r.destroy(); resolve(); }, 400);
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(upstreamClosed).toBe(true);
  }, 15000);
});

describe('reliability analytics', () => {
  it('GET /analytics/reliability is available to admins and protected from viewers', async () => {
    // MongoDB itself is mocked in this suite; feed the aggregation result in the shape $facet returns.
    require('../src/models/logModel').aggregate.mockResolvedValueOnce([{
      totals: [{ _id: null, calls: 4, retriedCalls: 1, totalRetries: 2, timeouts: 1, circuitOpen: 1, attemptsSum: 7 }],
      byProtocol: [{ _id: 'REST', calls: 4, retriedCalls: 1, totalRetries: 2, timeouts: 1, circuitOpen: 1, attemptsSum: 7 }],
    }]);
    const ok = await request(server).get('/api/v1/analytics/reliability').set(bearer(t.admin));
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.body.data.totals).toEqual({ calls: 4, retriedCalls: 1, totalRetries: 2, timeouts: 1, circuitOpen: 1, averageAttempts: 1.75 });
    expect(ok.body.data.byProtocol[0].protocol).toBe('REST');
    expect((await request(server).get('/api/v1/analytics/reliability')).status).toBe(401);
  });
});
