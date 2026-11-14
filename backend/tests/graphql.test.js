// Checklist item 16: a real GraphQL endpoint (POST /api/v1/graphql) alongside REST, plus forwarding GraphQL
// to an external GraphQL integration. Everything runs over real HTTP against real PostgreSQL.
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
const { breaker } = require('../src/outbound/circuitBreaker');

let server; let t; let up; const madeIntegrations = [];
const gql = (token, body) => request(server).post('/api/v1/graphql').set(bearer(token)).send(body);

beforeAll(async () => {
  up = await startMock((req, res) => json(res, 200, { data: { __typename: 'Query' } }));
  server = http.createServer(app).listen(0);
  t = await tokens(server);
});
afterAll(async () => {
  await pool.query('DELETE FROM integrations WHERE id = ANY($1::int[])', [madeIntegrations]);
  await up.close(); server.close(); await pool.end();
});

describe('GraphQL endpoint: queries', () => {
  it('answers a query with real data from the same services as REST', async () => {
    const res = await gql(t.admin, { query: '{ health { status service } me { email role } apis(limit: 2) { id name protocol } }' });
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.health.status).toBe('healthy');
    expect(res.body.data.me).toEqual({ email: 'kartik@example.com', role: 'SUPER_ADMIN' });
    const rest = await request(server).get('/api/v1/apis').set(bearer(t.admin));
    expect(res.body.data.apis.map((a) => a.id)).toEqual(rest.body.data.slice(0, 2).map((a) => a.id));
  });
  it('supports variables and operationName', async () => {
    const res = await gql(t.admin, {
      query: 'query A($id: Int!) { api(id: $id) { id } } query B { me { id } }', variables: { id: 999999 }, operationName: 'A',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.api).toBeNull();
    const b = await gql(t.admin, { query: 'query A { health { status } } query B { me { id } }', operationName: 'B' });
    expect(Object.keys(b.body.data)).toEqual(['me']);
  });
  it('supports GET for queries', async () => {
    const res = await request(server).get('/api/v1/graphql').query({ query: '{ health { status } }' }).set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.health.status).toBe('healthy');
  });
  it('refuses mutations over GET', async () => {
    const res = await request(server).get('/api/v1/graphql').query({ query: 'mutation { deleteIntegration(id: 1) }' }).set(bearer(t.admin));
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBeDefined();
  });
});

describe('GraphQL endpoint: errors', () => {
  it('401 without a token, in the unified envelope', async () => {
    const res = await request(server).post('/api/v1/graphql').send({ query: '{ health { status } }' });
    expectUnifiedError(res, { status: 401, code: 'UNAUTHORIZED' });
  });
  it('syntax error → 400 with envelope AND errors[]', async () => {
    const res = await gql(t.admin, { query: '{ health { ' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('GRAPHQL_PARSE_FAILED');
    expect(res.body.errors[0].extensions.code).toBe('GRAPHQL_PARSE_FAILED');
    expect(res.body.error.correlationId).toBe(res.headers['x-correlation-id']);
  });
  it('unknown field → 400 GRAPHQL_VALIDATION_FAILED', async () => {
    const res = await gql(t.admin, { query: '{ nope }' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GRAPHQL_VALIDATION_FAILED');
  });
  it('missing query, bad variables and batches are rejected', async () => {
    expect((await gql(t.admin, {})).status).toBe(400);
    expect((await gql(t.admin, { query: '{ me { id } }', variables: [1] })).status).toBe(400);
    const batch = await request(server).post('/api/v1/graphql').set(bearer(t.admin)).send([{ query: '{ me { id } }' }]);
    expect(batch.status).toBe(400);
  });
  it('depth limit', async () => {
    const q = `{ apis { id ${'__typename '.repeat(1)} } }`;
    expect((await gql(t.admin, { query: q })).status).toBe(200);
    // introspection chain is deep: __schema{types{fields{type{ofType{ofType{ofType{ofType{ofType{name}}}}}}}}}
    const deep = '{ __schema { types { fields { type { ofType { ofType { ofType { ofType { ofType { name } } } } } } } } } }';
    const res = await gql(t.admin, { query: deep });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GRAPHQL_QUERY_TOO_DEEP');
  });
  it('complexity limit (alias amplification)', async () => {
    const q = `{ ${Array.from({ length: 400 }, (_, i) => `a${i}: apis(limit: 50) { id name }`).join(' ')} }`;
    const res = await gql(t.admin, { query: q });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GRAPHQL_QUERY_TOO_COMPLEX');
  });
  it('fragment cycles do not hang the analyser', async () => {
    const res = await gql(t.admin, { query: 'query { me { ...A } } fragment A on User { ...B } fragment B on User { ...A }' });
    expect(res.status).toBe(400);
  });
  it('resolver errors come back as HTTP 200 + errors[] with catalog codes', async () => {
    const res = await gql(t.viewer, { query: 'mutation { deleteIntegration(id: 1) }' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    expect(res.body.errors[0].extensions.correlationId).toBeTruthy();
  });
});

describe('GraphQL endpoint: mutations on Integrations', () => {
  it('create → verify → update → delete over GraphQL, credential never returned', async () => {
    const create = await gql(t.admin, {
      query: `mutation($i: IntegrationInput!) { createIntegration(input: $i) { id name protocol authMode hasCredential status } }`,
      variables: { i: { name: 'GQL e2e', type: 'GraphQL', protocol: 'GRAPHQL', endpoint: `${up.url}/graphql`, authMode: 'bearer', credential: 'super-secret-token-123' } },
    });
    expect(create.body.errors).toBeUndefined();
    const it = create.body.data.createIntegration;
    madeIntegrations.push(it.id);
    expect(it.hasCredential).toBe(true);
    expect(JSON.stringify(create.body)).not.toContain('super-secret-token-123');
    expect(it.status).not.toBe('Connected'); // only a real verification may set Connected

    const ver = await gql(t.admin, { query: `mutation { verifyIntegration(id: ${it.id}) { status errorCode latencyMs } }` });
    expect(ver.body.data.verifyIntegration.status).toBe('Connected');
    const hit = up.hits.filter((h) => h.url === '/graphql').pop();
    expect(hit.headers.authorization).toBe('Bearer super-secret-token-123');
    expect(JSON.parse(hit.body).query).toContain('__typename');

    const upd = await gql(t.admin, { query: `mutation { updateIntegration(id: ${it.id}, input: { name: "GQL renamed" }) { name } }` });
    expect(upd.body.data.updateIntegration.name).toBe('GQL renamed');
    const del = await gql(t.admin, { query: `mutation { deleteIntegration(id: ${it.id}) }` });
    expect(del.body.data.deleteIntegration).toBe(true);
  });
  it('rejects invalid input with a validation error', async () => {
    const res = await gql(t.admin, {
      query: `mutation($i: IntegrationInput!) { createIntegration(input: $i) { id } }`,
      variables: { i: { name: 'bad', type: 'x', protocol: 'GRAPHQL', endpoint: 'http://169.254.169.254/latest' } },
    });
    expect(res.body.errors[0].extensions.code).toMatch(/VALIDATION_ERROR|SSRF|UPSTREAM_URL|BLOCKED/);
  });
});

describe('GraphQL forwarding to an external GraphQL integration', () => {
  let id;
  beforeAll(async () => {
    const r = await request(server).post('/api/v1/integrations').set(bearer(t.admin)).send({
      name: 'GQL upstream', type: 'GraphQL', protocol: 'GRAPHQL', endpoint: `${up.url}/graphql`, timeout_ms: 1000,
    });
    id = r.body.data.id; madeIntegrations.push(id);
  });
  beforeEach(() => { breaker.reset(`integration:${id}`); up.hits.length = 0; });
  const fwd = (b) => request(server).post(`/api/v1/integrations/${id}/graphql`).set(bearer(t.admin)).send(b);

  it('forwards query, variables and operationName and returns the upstream result', async () => {
    up.setHandler((req, res, body) => { const p = JSON.parse(body); json(res, 200, { data: { echo: p.variables.x, op: p.operationName } }); });
    const res = await fwd({ query: 'query Q($x: Int){ echo(x:$x) }', variables: { x: 7 }, operationName: 'Q' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(JSON.stringify(res.body)).toContain('"echo":7');
  });
  it('upstream HTTP 500 → 502 error in the unified envelope', async () => {
    up.setHandler((req, res) => json(res, 500, { oops: true }));
    const res = await fwd({ query: '{ a }' });
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.correlationId).toBeTruthy();
  });
  it('upstream non-JSON → UPSTREAM_INVALID_RESPONSE', async () => {
    up.setHandler((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); });
    const res = await fwd({ query: '{ a }' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPSTREAM_INVALID_RESPONSE');
  });
  it('upstream timeout → 504 UPSTREAM_TIMEOUT', async () => {
    up.setHandler(() => {});
    const res = await fwd({ query: '{ a }' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('UPSTREAM_TIMEOUT');
  }, 15000);
  it('retries a transient 503 on a query and then succeeds', async () => {
    let n = 0;
    up.setHandler((req, res) => { n += 1; if (n < 2) return json(res, 503, {}); return json(res, 200, { data: { a: 1 } }); });
    const res = await fwd({ query: '{ a }' });
    expect(res.status).toBe(200);
    expect(up.hits.length).toBe(2);
  });
  it('opens the circuit after repeated failures and fails fast with CIRCUIT_OPEN', async () => {
    up.setHandler((req, res) => json(res, 500, {}));
    for (let i = 0; i < 6; i += 1) await fwd({ query: '{ a }' });
    const before = up.hits.length;
    const res = await fwd({ query: '{ a }' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CIRCUIT_OPEN');
    expect(up.hits.length).toBe(before); // upstream not touched
  }, 30000);
  it('enforces the depth limit before forwarding', async () => {
    const q = `{ ${'a{'.repeat(12)}b${'}'.repeat(12)} }`;
    const res = await fwd({ query: q });
    expect(res.status).toBe(400);
    expect(up.hits.length).toBe(0);
  });
});
