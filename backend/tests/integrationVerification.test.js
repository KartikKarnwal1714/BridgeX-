// Integrations page backend: REST verification, credential handling, SSRF at registration, and the
// "Connected is only ever written by a real check" rule.
jest.mock('../src/models/logModel', () => ({
  create: jest.fn(async (d) => d), find: jest.fn(), findById: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(),
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
const { bearer, tokens, expectUnifiedError } = require('./helpers/phase5');
const { redactText, redactValue, MASK } = require('../src/utils/redactSecrets');

let server; let t; let up; const made = [];
const create = async (over = {}) => {
  const r = await request(server).post('/api/v1/integrations').set(bearer(t.admin)).send({
    name: `IV ${Math.random().toString(36).slice(2, 7)}`, type: 'REST', protocol: 'REST', endpoint: up.url, timeout_ms: 1500, ...over,
  });
  if (r.body.data) made.push(r.body.data.id);
  return r;
};
const verify = (id, token = t.admin) => request(server).post(`/api/v1/integrations/${id}/verifications`).set(bearer(token)).send({});

beforeAll(async () => { up = await startMock((req, res) => json(res, 200, { ok: true })); server = http.createServer(app).listen(0); t = await tokens(server); });
beforeEach(() => { up.hits.length = 0; up.setHandler((req, res) => json(res, 200, { ok: true })); });
afterAll(async () => { await pool.query('DELETE FROM integrations WHERE id = ANY($1::int[])', [made]); await up.close(); server.close(); await pool.end(); });

describe('REST verification', () => {
  it('a new integration is not Connected until a real request succeeds', async () => {
    const c = await create();
    expect(c.status).toBe(201);
    expect(c.body.data.status).not.toBe('Connected');
    expect(up.hits.length).toBe(0);
    const v = await verify(c.body.data.id);
    expect(v.status).toBe(201);
    expect(v.body.data.status).toBe('Connected');
    expect(up.hits.length).toBe(1);
    expect(v.headers.location).toMatch(/integrations\/\d+/);
    const got = await request(server).get(`/api/v1/integrations/${c.body.data.id}`).set(bearer(t.admin));
    expect(got.body.data.status).toBe('Connected');
    expect(got.body.data.last_verified_at).toBeTruthy();
    expect(got.body.data.last_verification_error).toBeNull();
  });
  it('uses config.healthPath', async () => {
    const c = await create({ config: { healthPath: '/healthz' } });
    await verify(c.body.data.id);
    expect(up.hits[0].url).toBe('/healthz');
  });
  it('a failing upstream marks the integration Failed and records the error', async () => {
    const c = await create();
    up.setHandler((req, res) => json(res, 500, {}));
    const v = await verify(c.body.data.id);
    expect(v.body.data.status).not.toBe('Connected');
    expect(v.body.data.error.code).toBeTruthy();
    const got = await request(server).get(`/api/v1/integrations/${c.body.data.id}`).set(bearer(t.admin));
    expect(got.body.data.status).not.toBe('Connected');
    expect(got.body.data.last_verification_error).toBeTruthy();
  });
  it('a timeout is reported as a failed verification, not a server crash', async () => {
    const c = await create({ timeout_ms: 700 });
    up.setHandler(() => {});
    const v = await verify(c.body.data.id);
    expect(v.status).toBe(201);
    expect(v.body.data.status).not.toBe('Connected');
    expect(v.body.data.error.code).toMatch(/TIMEOUT/);
  }, 15000);
  it('GraphQL verification sends a real __typename query', async () => {
    const c = await create({ type: 'GraphQL', protocol: 'GRAPHQL', endpoint: `${up.url}/graphql` });
    up.setHandler((req, res) => json(res, 200, { data: { __typename: 'Query' } }));
    const v = await verify(c.body.data.id);
    expect(v.body.data.status).toBe('Connected');
    expect(JSON.parse(up.hits[0].body).query).toMatch(/__typename/);
  });
  it('GraphQL verification fails when the endpoint is not GraphQL', async () => {
    const c = await create({ type: 'GraphQL', protocol: 'GRAPHQL', endpoint: `${up.url}/graphql` });
    up.setHandler((req, res) => json(res, 200, { hello: 'world' }));
    expect((await verify(c.body.data.id)).body.data.status).not.toBe('Connected');
  });
  it('viewers cannot verify; unknown id is 404', async () => {
    const c = await create();
    expectUnifiedError(await verify(c.body.data.id, t.viewer), { status: 403, code: 'FORBIDDEN' });
    expectUnifiedError(await verify(99999999), { status: 404, code: 'NOT_FOUND' });
  });
});

describe('credentials', () => {
  it('stored encrypted, sent upstream, never returned by any read', async () => {
    const c = await create({ auth_mode: 'header', auth_header: 'X-Api-Token', credential: 'rest-secret-ABC-123' });
    expect(c.status).toBe(201);
    expect(c.body.data.has_credential).toBe(true);
    await verify(c.body.data.id);
    expect(up.hits[0].headers['x-api-token']).toBe('rest-secret-ABC-123');
    const list = await request(server).get('/api/v1/integrations').set(bearer(t.admin));
    const one = await request(server).get(`/api/v1/integrations/${c.body.data.id}`).set(bearer(t.admin));
    for (const body of [c.body, list.body, one.body]) expect(JSON.stringify(body)).not.toContain('rest-secret-ABC-123');
    const row = await pool.query('SELECT credential_enc FROM integrations WHERE id=$1', [c.body.data.id]);
    expect(row.rows[0].credential_enc).toBeTruthy();
    expect(row.rows[0].credential_enc).not.toContain('rest-secret-ABC-123');
  });
  it('a credential is required when auth_mode needs one', async () => {
    expectUnifiedError(await create({ auth_mode: 'bearer' }), { status: 400, code: 'VALIDATION_ERROR' });
  });
  it('a forbidden auth header name is rejected', async () => {
    expect((await create({ auth_mode: 'header', auth_header: 'Host', credential: 'x' })).status).toBe(400);
  });
});

describe('SSRF at registration (no production bypass)', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://localhost:9/', 'file:///etc/passwd', 'http://[::1]/', 'ftp://example.com/',
  ])('refuses %s', async (endpoint) => {
    const r = await create({ endpoint });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
  });
});

describe('secret redaction helpers', () => {
  it('masks bearer tokens, JWTs, BridgeX keys, URL passwords and key=value secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop';
    const out = redactText(`Authorization: Bearer abc.def.ghi ${jwt} bx_live_0123456789abcdef0123456789abcdef https://u:p4ss@h.example/x?token=zzz password=hunter2 api_key: "k-123"`);
    for (const leaked of ['abc.def.ghi', jwt, '0123456789abcdef0123', 'p4ss', 'zzz', 'hunter2', 'k-123']) expect(out).not.toContain(leaked);
    expect(out).toContain(MASK);
  });
  it('masks nested object values by key name', () => {
    const out = redactValue({ headers: { authorization: 'Bearer x', 'x-api-key': 'k' }, nested: { password: 'p', ok: 1 } });
    expect(JSON.stringify(out)).not.toMatch(/Bearer x|"k"|"p"/);
    expect(out.nested.ok).toBe(1);
  });
});
