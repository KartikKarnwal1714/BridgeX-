// Local mock upstream used by the Phase 5 tests. Binds 127.0.0.1 on an ephemeral port and registers
// itself in GATEWAY_DEV_ALLOWED_UPSTREAMS (the existing development-only allowlist; refused in production).
const http = require('http');

function addAllowed(hostPort) {
  const cur = (process.env.GATEWAY_DEV_ALLOWED_UPSTREAMS || '').split(',').filter(Boolean);
  if (!cur.includes(hostPort)) cur.push(hostPort);
  process.env.GATEWAY_DEV_ALLOWED_UPSTREAMS = cur.join(',');
}

/**
 * handler(req, res, body, hit) is called for every request. `hits` records method/url/headers/body.
 * Returns { url, port, hits, close(), setHandler(fn) }.
 */
function startMock(handler) {
  let current = handler;
  const hits = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const hit = { method: req.method, url: req.url, headers: req.headers, body, at: Date.now() };
      hits.push(hit);
      current(req, res, body, hit, hits.length);
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      addAllowed(`127.0.0.1:${port}`);
      resolve({
        port, url: `http://127.0.0.1:${port}`, hits, server,
        setHandler(fn) { current = fn; },
        close() { sockets.forEach((s) => s.destroy()); return new Promise((r) => server.close(r)); },
      });
    });
  });
}

const json = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
};

module.exports = { startMock, json, addAllowed };
