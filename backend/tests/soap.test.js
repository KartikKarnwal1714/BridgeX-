// Checklist item 15: read a WSDL and make one real SOAP call. A real local SOAP 1.1/1.2 Calculator service
// (tests/helpers/mockSoap.js) answers genuine SOAP envelopes; WSDL import, faults, XXE/entity bombs,
// SSRF through <import>, size limits and secret redaction are all exercised over HTTP.
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
const { startSoapMock } = require('./helpers/mockSoap');
const { startMock } = require('./helpers/mockUpstream');
const { bearer, tokens, expectUnifiedError } = require('./helpers/phase5');
const { breaker } = require('../src/outbound/circuitBreaker');
const soapService = require('../src/soap/soapService');

let server; let t; let mock; const made = [];
const create = async (over = {}) => {
  const res = await request(server).post('/api/v1/integrations').set(bearer(t.admin)).send({
    name: `SOAP ${Math.random().toString(36).slice(2, 7)}`, type: 'SOAP', protocol: 'SOAP', endpoint: `${mock.url}/soap11`,
    config: { wsdlUrl: `${mock.url}/calculator.wsdl` }, timeout_ms: 3000, ...over,
  });
  if (res.body.data) made.push(res.body.data.id);
  return res;
};
const call = (id, body, token = t.admin) => request(server).post(`/api/v1/integrations/${id}/soap`).set(bearer(token)).send(body);

beforeAll(async () => {
  mock = await startSoapMock();
  server = http.createServer(app).listen(0);
  t = await tokens(server);
});
beforeEach(() => { mock.hits.length = 0; soapService.clearCache(); });
afterAll(async () => {
  await pool.query('DELETE FROM integrations WHERE id = ANY($1::int[])', [made]);
  await mock.close(); server.close(); await pool.end();
});

describe('WSDL reading and verification', () => {
  it('reads the WSDL (with an imported XSD) and lists the operations', async () => {
    const c = await create();
    expect(c.status).toBe(201);
    const res = await request(server).get(`/api/v1/integrations/${c.body.data.id}/operations`).set(bearer(t.admin));
    expect(res.status).toBe(200);
    const names = res.body.data.operations.map((o) => o.name).sort();
    expect(names).toEqual(['Add', 'Divide']);
    expect(mock.hits.some((h) => h.url === '/calculator.wsdl')).toBe(true);
    expect(mock.hits.some((h) => h.url === '/calculator-types.xsd')).toBe(true); // the import was followed
  });
  it('verification really fetches the WSDL and only then marks Connected', async () => {
    const c = await create();
    expect(c.body.data.status).not.toBe('Connected');
    const v = await request(server).post(`/api/v1/integrations/${c.body.data.id}/verifications`).set(bearer(t.admin)).send({});
    expect([200, 201]).toContain(v.status);
    expect(v.body.data.status).toBe('Connected');
    const got = await request(server).get(`/api/v1/integrations/${c.body.data.id}`).set(bearer(t.admin));
    expect(got.body.data.status).toBe('Connected');
    expect(got.body.data.last_verified_at).toBeTruthy();
  });
});

describe('real SOAP calls', () => {
  it('SOAP 1.1 Add(2,3) = 5, and the wire request is a genuine envelope', async () => {
    const c = await create();
    const res = await call(c.body.data.id, { operation: 'Add', arguments: { a: 2, b: 3 } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain('5');
    const hit = mock.hits.filter((h) => h.url === '/soap11').pop();
    expect(hit.method).toBe('POST');
    expect(hit.headers['content-type']).toMatch(/text\/xml/);
    expect(hit.body).toMatch(/Envelope/);
    expect(hit.body).toMatch(/<(\w+:)?Add[ >]/);
  });
  it('SOAP 1.2 works too', async () => {
    const c = await create({ endpoint: `${mock.url}/soap12`, config: { wsdlUrl: `${mock.url}/calculator.wsdl`, soapVersion: '1.2' } });
    const res = await call(c.body.data.id, { operation: 'Add', arguments: { a: 40, b: 2 } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain('42');
    const hit = mock.hits.filter((h) => h.url === '/soap12').pop();
    expect(hit.headers['content-type']).toMatch(/application\/soap\+xml/);
  });
  it('sends custom SOAP headers', async () => {
    const c = await create();
    await call(c.body.data.id, { operation: 'Add', arguments: { a: 1, b: 1 }, soapHeaders: [{ name: 'TraceId', namespace: 'urn:trace', value: 'abc-123' }] });
    expect(mock.hits.filter((h) => h.url === '/soap11').pop().body).toContain('abc-123');
  });
  it('a SOAP Fault becomes a unified 502 SOAP_FAULT error with the fault text', async () => {
    const c = await create();
    const res = await call(c.body.data.id, { operation: 'Divide', arguments: { a: 1, b: 0 } });
    expectUnifiedError(res, { status: 502, code: 'SOAP_FAULT' });
    expect(JSON.stringify(res.body)).toContain('Division by zero');
  });
  it('unknown operation → 400 SOAP_UNKNOWN_OPERATION', async () => {
    const c = await create();
    const res = await call(c.body.data.id, { operation: 'Nope', arguments: {} });
    expectUnifiedError(res, { status: 400, code: 'SOAP_UNKNOWN_OPERATION' });
  });
  it('validation: operation is required (unknown fields are stripped by the shared validator)', async () => {
    const c = await create();
    expectUnifiedError(await call(c.body.data.id, {}), { status: 400, code: 'VALIDATION_ERROR' });
    expectUnifiedError(await call(c.body.data.id, { operation: 7 }), { status: 400, code: 'VALIDATION_ERROR' });
  });
  it('a SOAP integration cannot take GraphQL calls and vice versa (409)', async () => {
    const c = await create();
    const res = await request(server).post(`/api/v1/integrations/${c.body.data.id}/graphql`).set(bearer(t.admin)).send({ query: '{ a }' });
    expect(res.status).toBe(409);
  });
  it('the SOAP endpoint address inside the WSDL is ignored in favour of the configured endpoint', async () => {
    const c = await create({ endpoint: `${mock.url}/soap12`, config: { wsdlUrl: `${mock.url}/calculator.wsdl`, soapVersion: '1.2' } });
    await call(c.body.data.id, { operation: 'Add', arguments: { a: 1, b: 2 } });
    expect(mock.hits.filter((h) => h.method === 'POST').every((h) => h.url === '/soap12')).toBe(true);
  });
  it('authorization: viewers may not call; unauthenticated is 401', async () => {
    const c = await create();
    expectUnifiedError(await call(c.body.data.id, { operation: 'Add', arguments: { a: 1, b: 1 } }, t.viewer), { status: 403, code: 'FORBIDDEN' });
    const anon = await request(server).post(`/api/v1/integrations/${c.body.data.id}/soap`).send({ operation: 'Add' });
    expect(anon.status).toBe(401);
  });
});

describe('hostile WSDLs are refused safely', () => {
  const bad = async (file, status = 502) => {
    const c = await create({ config: { wsdlUrl: `${mock.url}/${file}` } });
    const res = await request(server).get(`/api/v1/integrations/${c.body.data.id}/operations`).set(bearer(t.admin));
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/root:|passwd|169\.254|ENOENT/);
    return res;
  };
  it('DOCTYPE / external entity (XXE) → SOAP_INVALID_WSDL', async () => { expect((await bad('evil-xxe.wsdl')).body.error.code).toBe('SOAP_INVALID_WSDL'); });
  it('entity expansion bomb', async () => { expect((await bad('evil-bomb.wsdl')).body.error.code).toBe('SOAP_INVALID_WSDL'); });
  it('<import> of a file:// URL', async () => { await bad('evil-import-file.wsdl'); });
  it('<import> of the cloud metadata address is never fetched', async () => { await bad('evil-import-metadata.wsdl'); });
  it('<import> of a private address', async () => { await bad('evil-import-private.wsdl'); });
  it('<import> of another host', async () => { await bad('evil-import-otherhost.wsdl'); });
  it('redirect to the metadata address is not followed', async () => { await bad('evil-redirect.wsdl'); });
  it('oversized WSDL is refused', async () => { await bad('huge.wsdl'); });
  it('a document that is not a WSDL', async () => { await bad('not-wsdl.wsdl'); });
  it('registering a metadata/private WSDL URL is rejected at creation time', async () => {
    const res = await create({ config: { wsdlUrl: 'http://169.254.169.254/latest/meta-data' } });
    expect(res.status).toBe(400);
  });
});

describe('credentials and resilience', () => {
  it('sends the stored credential upstream, never returns it, never logs it', async () => {
    const c = await create({ auth_mode: 'bearer', credential: 'soap-secret-XYZ-987' });
    expect(JSON.stringify(c.body)).not.toContain('soap-secret-XYZ-987');
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const spyErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(c.body.data.id, { operation: 'Add', arguments: { a: 1, b: 1 } });
    expect(JSON.stringify(res.body)).not.toContain('soap-secret-XYZ-987');
    expect(mock.hits.filter((h) => h.url === '/soap11').pop().headers.authorization).toBe('Bearer soap-secret-XYZ-987');
    const logged = JSON.stringify([...spy.mock.calls, ...spyErr.mock.calls]);
    expect(logged).not.toContain('soap-secret-XYZ-987');
    spy.mockRestore(); spyErr.mockRestore();
    const row = await pool.query('SELECT credential_enc FROM integrations WHERE id=$1', [c.body.data.id]);
    expect(row.rows[0].credential_enc).not.toContain('soap-secret-XYZ-987');
  });
  it('upstream failing repeatedly opens the per-integration circuit and then fails fast', async () => {
    const down = await startMock((req, res) => { res.writeHead(503); res.end('down'); });
    const c = await create({ endpoint: `${down.url}/soap11`, timeout_ms: 2000 });
    breaker.reset(`integration:${c.body.data.id}`);
    for (let i = 0; i < 6; i += 1) await call(c.body.data.id, { operation: 'Add', arguments: { a: 1, b: 1 } });
    const before = down.hits.length;
    expect(before).toBeGreaterThanOrEqual(5);
    const res = await call(c.body.data.id, { operation: 'Add', arguments: { a: 1, b: 1 } });
    expectUnifiedError(res, { status: 503, code: 'CIRCUIT_OPEN' });
    expect(down.hits.length).toBe(before); // fail-fast: the dead upstream was not contacted
    await down.close();
  }, 30000);
});
