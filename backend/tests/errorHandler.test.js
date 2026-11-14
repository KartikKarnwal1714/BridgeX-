const errorHandler = require('../src/middleware/errorHandler');
const { ApiError } = require('../src/utils/response');

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('central API error handling', () => {
  it('maps PostgreSQL timeouts to a safe 503 envelope', () => {
    const res = response();
    errorHandler({ code: '57014', message: 'private SQL details' }, { path: '/api/v1/data', method: 'GET', correlationId: 'cid' }, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, error: { code: 'DATABASE_TIMEOUT' } });
    expect(JSON.stringify(res.body)).not.toContain('private SQL details');
  });

  it('adds Retry-After to a standard 429 error body', () => {
    const res = response();
    errorHandler(new ApiError(429, 'RATE_LIMITED', 'slow down'), { path: '/api/v1/data', method: 'GET', correlationId: 'cid' }, res, () => {});
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('60');
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.correlationId).toBe('cid');
  });

  it('passes errors onward when response headers have already been sent', () => {
    const res = response();
    res.headersSent = true;
    const next = jest.fn();
    const err = new Error('stream failed');

    errorHandler(err, { path: '/api/v1/stream', method: 'GET', correlationId: 'cid' }, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBeNull();
  });
});
