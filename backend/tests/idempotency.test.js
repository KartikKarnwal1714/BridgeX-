jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/database');
const idempotency = require('../src/middleware/idempotency');

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    set(name, value) { this.headers[name] = value; return this; },
    getHeader(name) { return this.headers[name] || this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function req(body = { name: 'CRM' }, key = 'req-1') {
  return { user: { id: 4 }, body, get: (name) => name === 'Idempotency-Key' ? key : undefined };
}

beforeEach(() => pool.query.mockReset());

describe('integration idempotency middleware', () => {
  it('reserves a key before continuing to the resource creation handler', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] });
    const res = response();
    const next = jest.fn();
    await idempotency('POST:/api/v1/integrations')(req(), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(pool.query.mock.calls[1][0]).toContain('ON CONFLICT (owner_id, operation, idempotency_key)');
    expect(res.headers['Idempotency-Replayed']).toBe('false');
  });

  it('replays the original status and body when the owner, operation, key and payload match', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({ rows: [{
      request_fingerprint: require('crypto').createHash('sha256').update(JSON.stringify({ accept: '', body: { name: 'CRM' } })).digest('hex'),
      response_status: 201, response_headers: { 'content-type': 'application/json' }, response_body: { id: 17 },
    }] });
    const res = response();
    const next = jest.fn();
    await idempotency('POST:/api/v1/integrations')(req(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 17 });
    expect(res.headers['Idempotency-Replayed']).toBe('true');
  });

  it('rejects reuse of a key with a different payload', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({ rows: [{
      request_fingerprint: 'a'.repeat(64), response_status: 201, response_headers: {}, response_body: {},
    }] });
    const next = jest.fn();
    await idempotency('POST:/api/v1/integrations')(req(), response(), next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});
