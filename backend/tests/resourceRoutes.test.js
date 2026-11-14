// Checklist item 11: resource-shaped URLs, no verbs. A lint over every registered route plus behaviour
// tests for the new noun-based routes and the deprecated legacy aliases that were kept.
jest.mock('../src/models/logModel', () => ({
  create: jest.fn(async (d) => { global.__logDocs.push(d); return d; }), find: jest.fn(), findById: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(),
}));
jest.mock('../src/config/mongo', () => ({
  isMongoConnected: () => true, connectMongo: jest.fn(),
  mongoose: { isValidObjectId: () => true, connection: { db: { admin: () => ({ ping: async () => {} }) } } },
}));
global.__logDocs = [];
const http = require('http');
const { request } = require('./helpers');
const app = require('../src/app');
const apiRouter = require('../src/routes');
const { listRoutes } = require('../src/utils/routeIntrospection');
const { pool } = require('../src/config/database');
const { bearer, tokens, expectUnifiedError, PASSWORD } = require('./helpers/phase5');

const VERBS = /^(get|set|create|update|delete|remove|add|list|fetch|find|search|do|run|execute|check|verify|test|login|logout|register|revoke|enable|disable|toggle|activate|deactivate|reset|send|call|invoke|submit|generate)$/i;
// Legacy aliases kept for backward compatibility with Phase 4 clients. They are DEPRECATED, documented
// as such in OpenAPI, and each has a resource-shaped replacement (see the tests below).
const LEGACY = new Set(['POST /api/v1/auth/register', 'POST /api/v1/auth/login', 'PATCH /api/v1/api-keys/{id}/revoke', 'PATCH /api/v1/api-keys/{id}/gateway']);

let server; let t; const made = [];
beforeAll(async () => { server = http.createServer(app).listen(0); t = await tokens(server); });
afterAll(async () => {
  await pool.query('DELETE FROM api_keys WHERE id = ANY($1::int[])', [made]);
  await pool.query("DELETE FROM users WHERE email LIKE 'rr-%@example.com'");
  server.close(); await pool.end();
});

describe('no verbs in resource URLs', () => {
  const routes = listRoutes(apiRouter);
  it('every non-legacy route path is made of nouns and parameters only', () => {
    const offenders = [];
    for (const r of routes) {
      if (LEGACY.has(`${r.method} ${r.path}`)) continue;
      for (const seg of r.path.split('/').filter(Boolean)) {
        if (seg.startsWith('{')) continue;
        if (VERBS.test(seg)) offenders.push(`${r.method} ${r.path} -> "${seg}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('the legacy allow-list is exactly the documented deprecated routes (no new verb routes can hide in it)', () => {
    const present = routes.map((r) => `${r.method} ${r.path}`);
    for (const l of LEGACY) expect(present).toContain(l);
    const verbRoutes = routes.filter((r) => r.path.split('/').some((s) => VERBS.test(s))).map((r) => `${r.method} ${r.path}`);
    for (const v of verbRoutes) expect(LEGACY.has(v)).toBe(true);
  });
  it('legacy routes are marked deprecated in OpenAPI', () => {
    const doc = require('yamljs').load(require('path').join(__dirname, '..', 'src', 'docs', 'openapi.yaml'));
    expect(doc.paths['/api-keys/{id}/revoke'].patch.deprecated).toBe(true);
    expect(doc.paths['/api-keys/{id}/gateway'].patch.deprecated).toBe(true);
    expect(doc.paths['/auth/login'].post.deprecated).toBe(true);
    expect(doc.paths['/auth/register'].post.deprecated).toBe(true);
  });
});

describe('PATCH /api-keys/:id replaces the verb routes', () => {
  let keyId;
  beforeAll(async () => {
    const k = await request(server).post('/api/v1/api-keys').set(bearer(t.developer)).send({ name: 'RR key', environment: 'Test' });
    keyId = k.body.data.id; made.push(keyId);
  });
  it('gateway settings are changed through the resource by an admin (same rule as the legacy route)', async () => {
    const res = await request(server).patch(`/api/v1/api-keys/${keyId}`).set(bearer(t.admin)).send({ rateLimitPerMinute: 77 });
    expect(res.status).toBe(200);
    expect(res.body.data.rateLimitPerMinute).toBe(77);
  });
  it('a developer may not change gateway settings (403 FORBIDDEN)', async () => {
    expectUnifiedError(await request(server).patch(`/api/v1/api-keys/${keyId}`).set(bearer(t.developer)).send({ rateLimitPerMinute: 5 }), { status: 403, code: 'FORBIDDEN' });
  });
  it('validates the body', async () => {
    expectUnifiedError(await request(server).patch(`/api/v1/api-keys/${keyId}`).set(bearer(t.developer)).send({ status: 'bogus' }), { status: 400, code: 'VALIDATION_ERROR' });
  });
  it('enforces ownership: another developer gets 403/404, never 200', async () => {
    const res = await request(server).patch(`/api/v1/api-keys/${keyId}`).set(bearer(t.developer2)).send({ status: 'revoked' });
    expect([403, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
  it('requires authentication', async () => {
    expect((await request(server).patch(`/api/v1/api-keys/${keyId}`).send({ status: 'revoked' })).status).toBe(401);
  });
  it('unknown key → 404 in the unified envelope', async () => {
    expectUnifiedError(await request(server).patch('/api/v1/api-keys/99999999').set(bearer(t.admin)).send({ status: 'revoked' }), { status: 404, code: 'NOT_FOUND' });
  });
  it('status "revoked" via PATCH revokes, and the deprecated /revoke alias still works with Deprecation headers', async () => {
    const k2 = await request(server).post('/api/v1/api-keys').set(bearer(t.developer)).send({ name: 'RR key 2', environment: 'Test' });
    made.push(k2.body.data.id);
    const viaPatch = await request(server).patch(`/api/v1/api-keys/${keyId}`).set(bearer(t.developer)).send({ status: 'revoked' });
    expect(viaPatch.status).toBe(200);
    expect(viaPatch.body.data.status).toMatch(/revoked/i);
    const legacy = await request(server).patch(`/api/v1/api-keys/${k2.body.data.id}/revoke`).set(bearer(t.developer)).send({});
    expect(legacy.status).toBe(200);
    expect(legacy.headers.deprecation).toBe('true');
    expect(legacy.headers.link).toMatch(/successor-version/);
  });
});

describe('/auth resources', () => {
  it('POST /auth/sessions logs in (same result as the legacy /auth/login) and GET /auth/sessions/current returns the user', async () => {
    const s = await request(server).post('/api/v1/auth/sessions').send({ email: 'kartik@example.com', password: PASSWORD });
    expect(s.status).toBe(200);
    expect(s.body.data.token).toBeTruthy();
    const cur = await request(server).get('/api/v1/auth/sessions/current').set(bearer(s.body.data.token));
    expect(cur.status).toBe(200);
    expect(cur.body.data.email).toBe('kartik@example.com');
    const bad = await request(server).post('/api/v1/auth/sessions').send({ email: 'kartik@example.com', password: 'wrong-Password1!' });
    expectUnifiedError(bad, { status: 401, code: 'INVALID_CREDENTIALS' });
  });
  it('POST /auth/registrations creates an account and the legacy /auth/register still works', async () => {
    const r = await request(server).post('/api/v1/auth/registrations').send({ name: 'RR One', email: 'rr-one@example.com', password: PASSWORD });
    expect([200, 201]).toContain(r.status);
    const r2 = await request(server).post('/api/v1/auth/register').send({ name: 'RR Two', email: 'rr-two@example.com', password: PASSWORD });
    expect([200, 201]).toContain(r2.status);
    const dup = await request(server).post('/api/v1/auth/registrations').send({ name: 'RR One', email: 'rr-one@example.com', password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.success).toBe(false);
  });
});
