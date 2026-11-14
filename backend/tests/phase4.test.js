const { app, request } = require('./helpers');
const { pool } = require('../src/config/database');
const logService = require('../src/services/logService');

afterAll(async () => {
  await pool.end();
});

describe('Phase 4 HTTP behavior', () => {
  it('returns 405 with Allow for a known resource and preserves 404 for unknown paths', async () => {
    const unsupported = await request(app).put('/api/v1/health/live');
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.allow).toContain('GET');
    expect(unsupported.body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect((await request(app).put('/api/v1/not-a-real-resource')).status).toBe(404);
  });

  it('generates an ETag and honors If-None-Match without a response body', async () => {
    const first = await request(app).get('/api/v1/health/live');
    expect(first.status).toBe(200);
    expect(first.headers.etag).toBeTruthy();
    expect(first.headers.vary).toContain('Accept');
    const conditional = await request(app).get('/api/v1/health/live').set('If-None-Match', first.headers.etag);
    expect(conditional.status).toBe(304);
    expect(conditional.text || '').toBe('');
  });

  it('negotiates XML, rejects unsupported formats, and defaults to JSON', async () => {
    const xml = await request(app).get('/api/v1/health/live').set('Accept', 'application/xml');
    expect(xml.status).toBe(200);
    expect(xml.headers['content-type']).toMatch(/application\/xml/);
    expect(xml.text).toContain('<response>');
    const unsupported = await request(app).get('/api/v1/health/live').set('Accept', 'text/csv');
    expect(unsupported.status).toBe(406);
    expect(unsupported.body.error.code).toBe('NOT_ACCEPTABLE');
    const json = await request(app).get('/api/v1/health/live');
    expect(json.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns malformed JSON through the central error envelope', async () => {
    const malformed = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ success: false, error: { code: 'INVALID_JSON' } });
    expect(malformed.headers['x-correlation-id']).toBeTruthy();
  });

  it('applies private and public cache policies and exposes CORS response headers', async () => {
    const live = await request(app).get('/api/v1/health/live');
    expect(live.headers['cache-control']).toBe('public, max-age=60, must-revalidate');
    const privateResponse = await request(app).get('/api/v1/integrations');
    expect(privateResponse.status).toBe(401);
    expect(privateResponse.headers['cache-control']).toBe('no-store');
    const preflight = await request(app).options('/api/v1/integrations').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,idempotency-key');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(preflight.headers['access-control-expose-headers']).toContain('ETag');
  });

  it('replaces malformed correlation IDs with a generated safe ID', async () => {
    const response = await request(app).get('/api/v1/health/live').set('X-Correlation-ID', 'unsafe id');
    expect(response.headers['x-correlation-id']).not.toBe('unsafe id');
    expect(response.headers['x-correlation-id']).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
  });

  it('rejects invalid cursor values before querying the log store', async () => {
    await expect(logService.listLogs({ cursor: 'not-a-cursor' })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
  });
});
