// Shared fixtures for the Phase 5 integration tests (real PostgreSQL, capturing MongoDB mock).
const { request } = require('../helpers');

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const PASSWORD = 'Password123!';
const login = async (target, email, password = PASSWORD) =>
  (async () => { const r = await request(target).post('/api/v1/auth/login').send({ email, password }); if (!r.body.data) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`); return r.body.data.token; })();

const tokens = async (target) => ({
  admin: await login(target, 'kartik@example.com'),
  developer: await login(target, 'priya@example.com'),
  developer2: await login(target, 'neha@example.com'),
  viewer: await login(target, 'rahul@example.com'),
});

// Shape every BridgeX-generated error must have.
function expectUnifiedError(res, { status, code }) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/json/);
  expect(res.body.success).toBe(false);
  expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'details', 'message']);
  expect(res.body.error.code).toBe(code);
  expect(typeof res.body.error.message).toBe('string');
  expect(Array.isArray(res.body.error.details)).toBe(true);
  expect(typeof res.body.error.correlationId).toBe('string');
  expect(res.body.error.correlationId.length).toBeGreaterThan(0);
  expect(res.body.error.correlationId).toBe(res.headers['x-correlation-id']);
  const text = JSON.stringify(res.body);
  // nothing internal may ever leak
  expect(text).not.toMatch(/SELECT |INSERT |UPDATE .* SET|password_hash|\bat [A-Za-z_.]+ \(|node_modules|eyJ[A-Za-z0-9_-]{10,}\.|bx_(live|test)_[a-f0-9]{16}|ECONNREFUSED|postgres(ql)?:\/\//i);
}

module.exports = { bearer, login, tokens, expectUnifiedError, PASSWORD };
