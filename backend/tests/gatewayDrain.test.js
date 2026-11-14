// Oversized gateway uploads: the 413 must reliably reach the client (no ECONNRESET), without ever buffering the
// discarded bytes, and abusive/slow clients must be cut off. Regression tests for src/gateway/drainRequest.js.
jest.mock('../src/models/logModel', () => ({
  create: jest.fn(async (d) => d), find: jest.fn(), findById: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(),
}));
jest.mock('../src/config/mongo', () => ({
  isMongoConnected: () => true, connectMongo: jest.fn(),
  mongoose: { isValidObjectId: () => true, connection: { db: { admin: () => ({ ping: async () => {} }) } } },
}));
const http = require('http');
const net = require('net');
const { request } = require('./helpers');
const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const { startMock, json } = require('./helpers/mockUpstream');
const { bearer, tokens, expectUnifiedError } = require('./helpers/phase5');
const rateLimiter = require('../src/gateway/rateLimiter');
const { drainRequest } = require('../src/gateway/drainRequest');

let server; let port; let t; let up; let slug; let apiId; let keyId; let rawKey;
const MB = 1024 * 1024;

// Raw TCP client that finishes WRITING the whole body before it starts READING - the worst case for a server
// that closes early with unread data.
function rawUpload(size, { chunked = false } = {}) {
  return new Promise((resolve) => {
    let data = ''; let err = null;
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`POST /gateway/${slug}/x HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${rawKey}\r\nContent-Type: application/json\r\n${chunked ? 'Transfer-Encoding: chunked' : `Content-Length: ${size}`}\r\n\r\n`);
      sock.pause();
      const c = Buffer.alloc(64 * 1024, 120); let sent = 0;
      (function w() {
        while (sent < size) {
          sent += c.length;
          const ok = chunked ? sock.write(Buffer.concat([Buffer.from(`${c.length.toString(16)}\r\n`), c, Buffer.from('\r\n')])) : sock.write(c);
          if (!ok) return sock.once('drain', w);
        }
        if (chunked) sock.write('0\r\n\r\n');
        sock.resume();
        return undefined;
      })();
    });
    sock.on('data', (d) => { data += d; });
    sock.on('error', (e) => { err = e.code; });
    sock.on('close', () => resolve({ err, data }));
  });
}
const body = (raw) => { const i = raw.indexOf('\r\n\r\n'); return i < 0 ? '' : raw.slice(i + 4); };

beforeAll(async () => {
  up = await startMock((req, res) => json(res, 200, { ok: true }));
  server = http.createServer(app).listen(0); port = server.address().port;
  t = await tokens(server);
  slug = `drain-${Date.now()}`;
  const a = await request(server).post('/api/v1/apis').set(bearer(t.admin)).send({ name: 'drain', protocol: 'REST', base_url: up.url, gateway_slug: slug, gateway_enabled: true, allowed_methods: ['GET', 'POST'] });
  apiId = a.body.data.id;
  const k = await request(server).post('/api/v1/api-keys').set(bearer(t.admin)).send({ name: 'drain key', environment: 'Test' });
  keyId = k.body.data.id; rawKey = k.body.data.key;
  await request(server).patch(`/api/v1/api-keys/${keyId}`).set(bearer(t.admin)).send({ apiIds: [apiId] });
});
beforeEach(() => { rateLimiter._resetMemoryForTests(); up.hits.length = 0; });
afterAll(async () => {
  await pool.query('DELETE FROM api_keys WHERE id=$1', [keyId]); await pool.query('DELETE FROM apis WHERE id=$1', [apiId]);
  await up.close(); server.close(); await pool.end();
});

describe('gateway 413 reaches the client', () => {
  it('declared Content-Length over the limit, 8 MB sent before reading: unified 413, X-BridgeX-Error, no reset', async () => {
    const { err, data } = await rawUpload(8 * MB);
    expect(err).toBeNull();
    expect(data).toMatch(/^HTTP\/1\.1 413/);
    expect(data.toLowerCase()).toContain('x-bridgex-error: true');
    expect(data.toLowerCase()).toContain('connection: close');
    const parsed = JSON.parse(body(data));
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(typeof parsed.error.correlationId).toBe('string');
    expect(up.hits.length).toBe(0); // nothing was forwarded upstream
  }, 30000);

  it('chunked upload (no Content-Length) over the limit also gets the unified 413', async () => {
    const { err, data } = await rawUpload(4 * MB, { chunked: true });
    expect(err).toBeNull();
    expect(data).toMatch(/^HTTP\/1\.1 413/);
    expect(JSON.parse(body(data)).error.code).toBe('PAYLOAD_TOO_LARGE');
  }, 30000);

  it('the limit itself is unchanged: a body under 1 MiB is still proxied', async () => {
    expect(env.GATEWAY_MAX_BODY_BYTES).toBe(1024 * 1024);
    const res = await request(server).post(`/gateway/${slug}/x`).set('Authorization', `Bearer ${rawKey}`).send({ blob: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(200);
    expect(up.hits.length).toBe(1);
  });

  it('supertest style (single write of 2 MiB JSON) still gets the standard envelope', async () => {
    const res = await request(server).post(`/gateway/${slug}/x`).set('Authorization', `Bearer ${rawKey}`).send({ blob: 'x'.repeat(2 * MB) });
    expectUnifiedError(res, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(res.headers['x-bridgex-error']).toBe('true');
  });
});

describe('abuse protection', () => {
  it('a declared size above the discard cap is answered and the connection closed without draining', async () => {
    const original = env.GATEWAY_REJECT_DRAIN_MAX_BYTES;
    env.GATEWAY_REJECT_DRAIN_MAX_BYTES = 2 * MB;
    try {
      const before = process.memoryUsage().rss;
      const { data } = await rawUpload(24 * MB);
      expect(process.memoryUsage().rss - before).toBeLessThan(150 * MB); // discarded data is never buffered
      if (data) expect(data).toMatch(/^HTTP\/1\.1 413/); // the client may or may not still read it, but never a 2xx
    } finally { env.GATEWAY_REJECT_DRAIN_MAX_BYTES = original; }
  }, 30000);

  it('a client that stops sending is cut off after the drain timeout', async () => {
    const original = env.GATEWAY_REJECT_DRAIN_TIMEOUT_MS;
    env.GATEWAY_REJECT_DRAIN_TIMEOUT_MS = 300;
    try {
      const started = Date.now();
      const result = await new Promise((resolve) => {
        let data = '';
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write(`POST /gateway/${slug}/x HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${rawKey}\r\nContent-Length: ${5 * MB}\r\n\r\n`);
          sock.write(Buffer.alloc(1000, 120)); // ...then silence (slow-loris)
        });
        sock.on('data', (d) => { data += d; });
        sock.on('error', () => {});
        sock.on('close', () => resolve(data));
      });
      expect(Date.now() - started).toBeLessThan(4000);
      expect(result).toMatch(/^HTTP\/1\.1 413/);
    } finally { env.GATEWAY_REJECT_DRAIN_TIMEOUT_MS = original; }
  }, 15000);
});

describe('drainRequest unit behaviour', () => {
  const withServer = (handler) => new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, () => resolve(s));
  });

  it('discards a body, resolves "drained", and does not buffer it', async () => {
    let result; let chunks = 0;
    const s = await withServer(async (req, res) => {
      req.on('data', () => { chunks += 1; });
      result = await drainRequest(req, { maxBytes: 64 * MB, timeoutMs: 5000 });
      res.end('ok');
    });
    await new Promise((resolve) => {
      const r = http.request({ port: s.address().port, method: 'POST' }, (res) => { res.resume(); res.on('end', resolve); });
      r.end(Buffer.alloc(4 * MB, 1));
    });
    expect(['drained', 'complete']).toContain(result);
    expect(chunks).toBeGreaterThan(0);
    s.close();
  });
  it('stops at the byte cap', async () => {
    let result;
    const s = await withServer(async (req, res) => { result = await drainRequest(req, { maxBytes: 1 * MB, timeoutMs: 5000 }); req.destroy(); res.destroy(); });
    await new Promise((resolve) => {
      const r = http.request({ port: s.address().port, method: 'POST' }); r.on('error', resolve); r.on('response', resolve);
      r.end(Buffer.alloc(8 * MB, 1));
    });
    expect(result).toBe('cap');
    s.close();
  });
  it('stops at the timeout', async () => {
    let result;
    const s = await withServer(async (req, res) => { result = await drainRequest(req, { maxBytes: 64 * MB, timeoutMs: 200 }); req.destroy(); res.destroy(); });
    await new Promise((resolve) => {
      const r = http.request({ port: s.address().port, method: 'POST', headers: { 'Content-Length': 1000 } }); r.on('error', resolve);
      r.write('abc'); setTimeout(() => { r.destroy(); resolve(); }, 700);
    });
    expect(result).toBe('timeout');
    s.close();
  });
  it('reports "closed" when the client disconnects mid-upload', async () => {
    let result;
    const s = await withServer(async (req, res) => { result = await drainRequest(req, { maxBytes: 64 * MB, timeoutMs: 5000 }); res.destroy(); });
    await new Promise((resolve) => {
      const r = http.request({ port: s.address().port, method: 'POST', headers: { 'Content-Length': 100000 } }); r.on('error', () => {});
      r.write(Buffer.alloc(1000)); setTimeout(() => { r.destroy(); setTimeout(resolve, 100); }, 100);
    });
    expect(['closed', 'error']).toContain(result);
    s.close();
  });
});
