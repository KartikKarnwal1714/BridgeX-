// Checklist item 9: ONE error body everywhere. Every category of BridgeX-generated error is produced for
// real (HTTP in, HTTP out) and checked against the same envelope and the same safety rules.
const logDocs = [];
jest.mock('../src/models/logModel', () => ({
  create: jest.fn(async (doc) => { logDocs.push(doc); return doc; }), find: jest.fn(), findById: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(),
}));
jest.mock('../src/config/mongo', () => ({
  isMongoConnected: () => true, connectMongo: jest.fn(),
  mongoose: { isValidObjectId: () => true, connection: { db: { admin: () => ({ ping: async () => {} }) } } },
}));

const http = require('http');
const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');
const { request } = require('./helpers');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { startMock, json } = require('./helpers/mockUpstream');
const { bearer, tokens, expectUnifiedError } = require('./helpers/phase5');
const { CATALOG } = require('../src/errors/catalog');
const errorHandler = require('../src/middleware/errorHandler');
const { ApiError } = require('../src/utils/response');
const rateLimiter = require('../src/gateway/rateLimiter');
const { breaker } = require('../src/outbound/circuitBreaker');
const apiModel = require('../src/models/apiModel');
const apiKeyModel = require('../src/models/apiKeyModel');

let server; let t; let up; const made = { api: [], key: [] };
let gwKey; let gwKeyId;

async function makeApi(over = {}) {
  const res = await request(server).post('/api/v1/apis').set(bearer(t.admin)).send({
    name: `UE ${Math.random().toString(36).slice(2, 7)}`, protocol: 'REST', base_url: up.url, gateway_slug: `ue-${Math.random().toString(36).slice(2, 9)}`, gateway_enabled: true, ...over,
  });
  made.api.push(res.body.data.id);
  await request(server).patch(`/api/v1/api-keys/${gwKeyId}`).set(bearer(t.admin)).send({ apiIds: [...made.api] });
  return res.body.data;
}
const gw = (slug, p = '/x', method = 'get') => request(server)[method](`/gateway/${slug}${p}`).set('Authorization', `Bearer ${gwKey}`);

beforeAll(async () => {
  up = await startMock((req, res) => json(res, 200, { ok: true }));
  server = http.createServer(app).listen(0);
  t = await tokens(server);
  const k = await request(server).post('/api/v1/api-keys').set(bearer(t.admin)).send({ name: 'UE key', environment: 'Test' });
  gwKey = k.body.data.key; gwKeyId = k.body.data.id; made.key.push(gwKeyId);
});
beforeEach(() => { rateLimiter._resetMemoryForTests(); up.hits.length = 0; up.setHandler((req, res) => json(res, 200, { ok: true })); });
afterAll(async () => {
  await pool.query('DELETE FROM api_keys WHERE id = ANY($1::int[])', [made.key]);
  await pool.query('DELETE FROM apis WHERE id = ANY($1::int[])', [made.api]);
  await up.close(); server.close(); await pool.end();
});

describe('dashboard API errors share one envelope', () => {
  it('validation error (400 VALIDATION_ERROR) lists the offending fields', async () => {
    const res = await request(server).post('/api/v1/integrations').set(bearer(t.admin)).send({ name: 'x' });
    expectUnifiedError(res, { status: 400, code: 'VALIDATION_ERROR' });
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
  it('malformed JSON (400 INVALID_JSON)', async () => {
    const res = await request(server).post('/api/v1/auth/sessions').set('Content-Type', 'application/json').send('{"email": ');
    expectUnifiedError(res, { status: 400, code: 'INVALID_JSON' });
  });
  it('missing token (401 UNAUTHORIZED) and bad token', async () => {
    expectUnifiedError(await request(server).get('/api/v1/integrations'), { status: 401, code: 'UNAUTHORIZED' });
    expectUnifiedError(await request(server).get('/api/v1/integrations').set('Authorization', 'Bearer not.a.jwt'), { status: 401, code: 'UNAUTHORIZED' });
  });
  it('wrong password (401 INVALID_CREDENTIALS)', async () => {
    expectUnifiedError(await request(server).post('/api/v1/auth/sessions').send({ email: 'kartik@example.com', password: 'wrong-password-1' }), { status: 401, code: 'INVALID_CREDENTIALS' });
  });
  it('insufficient role (403 FORBIDDEN)', async () => {
    expectUnifiedError(await request(server).delete('/api/v1/integrations/1').set(bearer(t.viewer)), { status: 403, code: 'FORBIDDEN' });
  });
  it('missing resource (404 NOT_FOUND) and unknown route (404 NOT_FOUND)', async () => {
    expectUnifiedError(await request(server).get('/api/v1/integrations/99999999').set(bearer(t.admin)), { status: 404, code: 'NOT_FOUND' });
    expectUnifiedError(await request(server).get('/api/v1/nope').set(bearer(t.admin)), { status: 404, code: 'NOT_FOUND' });
  });
  it('bad identifier format is a 400, not a database error', async () => {
    expectUnifiedError(await request(server).get('/api/v1/integrations/not-a-number').set(bearer(t.admin)), { status: 400, code: 'VALIDATION_ERROR' });
  });
  it('wrong method on a known resource (405 METHOD_NOT_ALLOWED + Allow)', async () => {
    const res = await request(server).put('/api/v1/health').set(bearer(t.admin));
    expectUnifiedError(res, { status: 405, code: 'METHOD_NOT_ALLOWED' });
    expect(res.headers.allow).toMatch(/GET/);
  });
  it('unsupported Accept (406 NOT_ACCEPTABLE)', async () => {
    expectUnifiedError(await request(server).get('/api/v1/health').set('Accept', 'text/csv'), { status: 406, code: 'NOT_ACCEPTABLE' });
  });
  it('conflict (409 EMAIL_IN_USE)', async () => {
    expectUnifiedError(await request(server).post('/api/v1/auth/registrations').send({ name: 'Dup', email: 'kartik@example.com', password: 'Password123!' }), { status: 409, code: 'EMAIL_IN_USE' });
  });
  it('conflict (409 GATEWAY_ROUTE_CONFLICT)', async () => {
    const a = await makeApi();
    const res = await request(server).post('/api/v1/apis').set(bearer(t.admin)).send({ name: 'Dup route', protocol: 'REST', base_url: up.url, gateway_slug: a.gateway_slug });
    expectUnifiedError(res, { status: 409, code: 'GATEWAY_ROUTE_CONFLICT' });
  });
  it('oversized JSON body (413 PAYLOAD_TOO_LARGE)', async () => {
    const res = await request(server).post('/api/v1/auth/sessions').send({ email: 'a@b.co', password: 'x'.repeat(200000) });
    expectUnifiedError(res, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });
  it('global rate limit (429 RATE_LIMITED + Retry-After) uses the same envelope', async () => {
    const res = await new Promise((resolve) => {
      const handler = errorHandler;
      const r = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve(this); return this; } };
      handler(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please retry later.'), { path: '/x', method: 'GET', correlationId: 'cid-429' }, r, () => {});
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('60');
    expect(res.body).toEqual({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please retry later.', details: [], correlationId: 'cid-429' } });
  });
  it('unexpected exceptions become a generic 500 with no internals', async () => {
    const spy = jest.spyOn(apiModel, 'findAll').mockRejectedValue(new Error('boom: SELECT * FROM apis WHERE password=hunter2 at /srv/app/secret.js:12'));
    try {
      const res = await request(server).get('/api/v1/apis').set(bearer(t.admin));
      expectUnifiedError(res, { status: 500, code: 'INTERNAL_SERVER_ERROR' });
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|boom|secret\.js/);
    } finally { spy.mockRestore(); }
  });
  it('database errors are mapped without leaking SQL (503 DATABASE_TIMEOUT / DATABASE_UNAVAILABLE)', async () => {
    const spy = jest.spyOn(apiModel, 'findAll');
    try {
      spy.mockRejectedValueOnce(Object.assign(new Error('canceling statement: SELECT secret FROM x'), { code: '57014' }));
      expectUnifiedError(await request(server).get('/api/v1/apis').set(bearer(t.admin)), { status: 503, code: 'DATABASE_TIMEOUT' });
      spy.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:5432'), { code: 'ECONNREFUSED' }));
      expectUnifiedError(await request(server).get('/api/v1/apis').set(bearer(t.admin)), { status: 503, code: 'DATABASE_UNAVAILABLE' });
    } finally { spy.mockRestore(); }
  });
  it('echoes a caller-supplied correlation id in the error body and header', async () => {
    const res = await request(server).get('/api/v1/nope').set('X-Correlation-ID', 'caller-id-42').set(bearer(t.admin));
    expect(res.body.error.correlationId).toBe('caller-id-42');
    expect(res.headers['x-correlation-id']).toBe('caller-id-42');
  });
});

describe('gateway-generated errors use the same envelope (X-BridgeX-Error marks them)', () => {
  it('401 missing/invalid key', async () => {
    const res = await request(server).get('/gateway/whatever/x');
    expectUnifiedError(res, { status: 401, code: 'UNAUTHORIZED' });
    expect(res.headers['x-bridgex-error']).toBe('true');
    expect(res.body.requestId).toBe(res.body.error.correlationId);
  });
  it('404 unknown route, 403 not granted', async () => {
    expectUnifiedError(await gw('no-such-slug'), { status: 404, code: 'ROUTE_NOT_FOUND' });
    const other = await request(server).post('/api/v1/apis').set(bearer(t.admin)).send({ name: 'UE ungranted', protocol: 'REST', base_url: up.url, gateway_slug: `ue-ng-${Date.now() % 100000}`, gateway_enabled: true });
    made.api.push(other.body.data.id);
    expectUnifiedError(await gw(other.body.data.gateway_slug), { status: 403, code: 'FORBIDDEN' });
  });
  it('429 rate limit exceeded with Retry-After', async () => {
    const a = await makeApi();
    await request(server).patch(`/api/v1/api-keys/${gwKeyId}`).set(bearer(t.admin)).send({ rateLimitPerMinute: 1 });
    await gw(a.gateway_slug);
    const res = await gw(a.gateway_slug);
    expectUnifiedError(res, { status: 429, code: 'RATE_LIMIT_EXCEEDED' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    await request(server).patch(`/api/v1/api-keys/${gwKeyId}`).set(bearer(t.admin)).send({ rateLimitPerMinute: 1000 });
  });
  it('504 upstream timeout', async () => {
    const a = await makeApi({ timeout_ms: 200 });
    up.setHandler((req, res) => setTimeout(() => res.end('late'), 1500));
    expectUnifiedError(await gw(a.gateway_slug), { status: 504, code: 'UPSTREAM_TIMEOUT' });
  });
  it('502 upstream unreachable (no address leaked)', async () => {
    const dead = await startMock((req, res) => res.end()); const port = dead.port; await dead.close();
    const a = await makeApi({ base_url: `http://127.0.0.1:${port}` });
    const res = await gw(a.gateway_slug);
    expectUnifiedError(res, { status: 502, code: 'UPSTREAM_UNREACHABLE' });
    expect(JSON.stringify(res.body)).not.toContain(String(port));
  });
  it('503 CIRCUIT_OPEN with Retry-After once the upstream keeps failing', async () => {
    const a = await makeApi({ allowed_methods: ['GET', 'POST'] });
    await breaker.reset(`api:${a.id}`);
    up.setHandler((req, res) => json(res, 500, { upstream: 'broken' }));
    for (let i = 0; i < 5; i += 1) expect((await gw(a.gateway_slug, '/x', 'post').send({})).status).toBe(500);
    const res = await gw(a.gateway_slug, '/x', 'post').send({});
    expectUnifiedError(res, { status: 503, code: 'CIRCUIT_OPEN' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['x-bridgex-error']).toBe('true');
    await breaker.reset(`api:${a.id}`);
  });
  it('413 request body too large', async () => {
    const a = await makeApi({ allowed_methods: ['GET', 'POST'] });
    const res = await gw(a.gateway_slug, '/x', 'post').send({ blob: 'x'.repeat(2 * 1024 * 1024) });
    expectUnifiedError(res, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });
  it('503 gateway unavailable when the database is down, and 500 for unexpected failures', async () => {
    const spy = jest.spyOn(apiKeyModel, 'findByHash');
    try {
      spy.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), { code: 'ECONNREFUSED' }));
      expectUnifiedError(await gw('x'), { status: 503, code: 'SERVICE_UNAVAILABLE' });
      spy.mockRejectedValueOnce(new Error('kaboom with password=hunter2'));
      const res = await gw('x');
      expectUnifiedError(res, { status: 500, code: 'INTERNAL_SERVER_ERROR' });
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|kaboom/);
    } finally { spy.mockRestore(); }
  });
});

describe('documented passthrough: upstream-generated responses are NOT rewritten', () => {
  it('an upstream 500 with its own body is passed through unchanged and is not marked as BridgeX-generated', async () => {
    const a = await makeApi();
    await breaker.reset(`api:${a.id}`);
    up.setHandler((req, res) => json(res, 500, { vendorError: { id: 'E-77', text: 'vendor format' } }));
    const res = await gw(a.gateway_slug);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ vendorError: { id: 'E-77', text: 'vendor format' } });
    expect(res.headers['x-bridgex-error']).toBeUndefined();
    await breaker.reset(`api:${a.id}`);
  });
});

describe('error catalog consistency', () => {
  it('every code used by the source tree exists in the catalog', () => {
    const used = new Set();
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      if (!p.endsWith('.js')) return undefined;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/(?:ApiError|GatewayError|OutboundError|MK|gw|soapError|GraphqlRequestError)\(\s*(?:\d{3},\s*)?'([A-Z][A-Z_]+)'/g)) used.add(m[1]);
      return undefined;
    });
    walk(path.join(__dirname, '../src'));
    const unknown = [...used].filter((c) => !CATALOG[c]);
    expect(unknown).toEqual([]);
  });
  it('the OpenAPI ErrorCode enum equals the catalog', () => {
    const doc = YAML.load(path.join(__dirname, '../src/docs/openapi.yaml'));
    expect(doc.components.schemas.ErrorCode.enum.slice().sort()).toEqual(Object.keys(CATALOG).sort());
  });
  it('a code missing from the catalog is reported by the handler (never silently invented)', () => {
    const logger = require('../src/utils/logger');
    const spy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const r = { headers: {}, setHeader() {}, getHeader() {}, status() { return this; }, json() { return this; } };
    errorHandler(new ApiError(400, 'MADE_UP_CODE', 'x'), { path: '/', method: 'GET', correlationId: 'c' }, r, () => {});
    expect(spy.mock.calls.some(([m]) => m === 'error_code_not_in_catalog')).toBe(true);
    spy.mockRestore();
  });
});
