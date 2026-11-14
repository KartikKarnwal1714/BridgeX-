// Streams one request to an upstream and the response back, without buffering either body.
// The connection itself (timeouts, size limits, SSRF guard, pooling, retry, circuit breaker,
// cancellation) is the shared outbound client in ../outbound/client.js - the gateway adds only the
// gateway-specific parts: header policy, response streaming, and mapping failures to GatewayError.
const { pipeline, Transform } = require('stream');
const env = require('../config/env');
const { GatewayError } = require('./errors');
const { filterResponseHeaders } = require('./headers');
const { validateUpstreamUrl } = require('../utils/ssrf');
const outbound = require('../outbound/client');
const { toOutboundError } = require('../outbound/errors');

/** OutboundError (or any raw error) -> GatewayError, the gateway's error type. */
function toGatewayError(err) {
  const out = toOutboundError(err);
  const headers = { ...(out.headers || {}) };
  return new GatewayError(out.statusCode, out.code, out.message, { category: out.category, outcome: out.outcome, headers });
}

// Kept for callers that classify raw network errors.
function classify(err) {
  return toGatewayError(err);
}

function counter(onBytes, limit, code) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      onBytes(total);
      if (total > limit) {
        const err = new Error('size limit exceeded');
        err.code = code;
        return cb(err);
      }
      return cb(null, chunk);
    },
  });
}

function applyMeta(gw, meta) {
  if (!meta) return;
  gw.forwarded = meta.attempts > 0;
  gw.attempts = meta.attempts;
  gw.retries = meta.retries;
  gw.retryDelayMs = meta.retryDelayMs;
  gw.timedOut = meta.timedOut;
  gw.breakerState = meta.breakerState;
  gw.circuitOpen = meta.circuitOpen;
  if (meta.upstreamMs !== null) gw.upstreamMs = meta.upstreamMs;
  if (meta.upstreamStatus !== null) gw.upstreamStatus = meta.upstreamStatus;
}

/**
 * Resolves when the response has been fully streamed to the client. Rejects with a GatewayError if
 * the failure happened before any response bytes were sent (so the caller can still send a clean error).
 */
async function forward({ req, res, api, upstreamPath, headers, gw }) {
  try {
    validateUpstreamUrl(api.base_url); // re-checked on every request, not just at save time
  } catch {
    throw toGatewayError(Object.assign(new Error('blocked'), { code: 'EBLOCKEDADDRESS' }));
  }

  const timeoutMs = Math.min(api.timeout_ms, env.GATEWAY_MAX_TIMEOUT_MS);
  const started = Date.now();

  // Client went away: cancel the upstream request, any pending retry pause, and free the socket.
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) {
      gw.aborted = true;
      ac.abort();
    }
  });

  const hasBody = req.headers['content-length'] !== undefined || req.headers['transfer-encoding'] !== undefined;
  const method = req.method;

  let up;
  try {
    up = await outbound.requestStream({
      label: 'gateway',
      url: api.base_url,
      path: upstreamPath,
      method,
      headers,
      body: hasBody ? req : undefined,
      signal: ac.signal,
      correlationId: gw.requestId,
      timeouts: {
        connectMs: Math.min(env.OUTBOUND_CONNECT_TIMEOUT_MS, timeoutMs),
        responseMs: timeoutMs,
        idleMs: timeoutMs,
        // The API's timeout_ms is the TOTAL budget for the call, retries included: a client that configured
        // 300 ms never waits several multiples of that because of retries.
        totalMs: timeoutMs,
      },
      limits: { maxRequestBytes: env.GATEWAY_MAX_BODY_BYTES, maxResponseBytes: env.GATEWAY_MAX_RESPONSE_BYTES },
      retry: {
        enabled: env.GATEWAY_RETRY_ENABLED,
        retryOnStatuses: [502, 503, 504], // 429/408 from the upstream are the client's to handle
      },
      breaker: { key: `api:${api.id}` },
      maxRedirects: 0, // 3xx responses are passed through to the client, never followed
    });
  } catch (err) {
    const out = toOutboundError(err);
    applyMeta(gw, out.meta);
    if (!hasBody) gw.requestBytes = 0;
    throw toGatewayError(out);
  }

  applyMeta(gw, up.meta);
  gw.requestBytes = up.meta.requestBytes;
  gw.upstreamStatus = up.status;
  gw.upstreamMs = Date.now() - started;

  await new Promise((resolve) => {
    res.status(up.status);
    const filtered = filterResponseHeaders(up.headers);
    Object.entries(filtered).forEach(([name, value]) => res.setHeader(name, value));

    const limiter = counter((n) => { gw.responseBytes = n; }, env.GATEWAY_MAX_RESPONSE_BYTES, 'BX_RESPONSE_TOO_LARGE');
    pipeline(up.stream, limiter, res, (err) => {
      if (err && !gw.aborted) {
        const e = toOutboundError(err);
        gw.errorCategory = err.code === 'BX_RESPONSE_TOO_LARGE' ? 'upstream_response_too_large' : e.category;
        if (e.category.includes('timeout')) gw.timedOut = true;
        gw.outcome = 'gateway_error';
        res.destroy(); // headers are already out, so the only honest signal left is a broken connection
      }
      resolve();
    });
  });
}

module.exports = { forward, classify, toGatewayError };
