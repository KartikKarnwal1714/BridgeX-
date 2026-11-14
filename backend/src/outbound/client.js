// The ONE outbound HTTP client. The REST gateway, GraphQL forwarding, SOAP/WSDL and integration
// connection tests all call upstreams through this module; nothing else in BridgeX opens an outbound
// HTTP connection.
//
// Every call is bounded:
//   connect timeout   - TCP (+TLS) establishment
//   response timeout  - request sent -> response headers (per attempt)
//   idle timeout      - silence between body chunks once a response has started
//   total deadline    - the whole call, including retries and backoff pauses
//   size limits       - request body and response body, enforced while streaming
// and guarded:
//   SSRF              - URL validated before every attempt (and every redirect hop); DNS answers checked at
//                       connect time and the connection is made to the checked address (no rebinding)
//   redirects         - not followed by default; opt-in for GET/HEAD only, re-validated per hop, no
//                       https->http downgrade, credentials stripped when the origin changes
//   TLS               - certificate verification left at Node's secure default
//   cancellation      - an AbortSignal (e.g. client disconnect) stops the attempt, any pending backoff,
//                       and releases the socket
//   circuit breaker   - checked before EVERY attempt, so retries stop as soon as a circuit opens
//   retry             - exponential backoff with jitter, Retry-After, idempotency rules (see retry.js)
// Secrets never reach logs: only method, origin+path (no query), status, timings and error categories.
const http = require('http');
const https = require('https');
const net = require('net');
const { Readable, Transform } = require('stream');
const env = require('../config/env');
const logger = require('../utils/logger');
const { validateUpstreamUrl, guardedLookup, isBlockedAddress, portOf } = require('../utils/ssrf');
const { OutboundError, toOutboundError, circuitOpenError } = require('./errors');
const { resolvePolicy, backoffDelay, parseRetryAfter, evaluateRetry } = require('./retry');
const { breaker: sharedBreaker } = require('./circuitBreaker');

// ---- connection pooling -----------------------------------------------------------------------------
// Keep-alive pools, bounded in size. Safe to share: a pooled socket was connected to an address that
// passed the SSRF check, requests carry their own headers/credentials, and idle sockets are closed
// after a short time. maxSockets bounds concurrency per origin so a slow upstream cannot exhaust
// BridgeX's file descriptors.
let agents = null;
function getAgents() {
  if (!agents) {
    const common = {
      keepAlive: env.OUTBOUND_KEEP_ALIVE,
      keepAliveMsecs: 15000,
      maxSockets: env.OUTBOUND_MAX_SOCKETS,
      maxFreeSockets: env.OUTBOUND_MAX_FREE_SOCKETS,
      timeout: 60000, // idle pooled sockets are destroyed after this
      scheduling: 'lifo',
    };
    agents = { 'http:': new http.Agent(common), 'https:': new https.Agent(common) };
  }
  return agents;
}
function closeAgents() {
  if (agents) {
    agents['http:'].destroy();
    agents['https:'].destroy();
    agents = null;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'x-api-key'];

const stripBrackets = (h) => (h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h);
const codeErr = (code, message = code) => Object.assign(new Error(message), { code });
const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(codeErr('BX_ABORTED'));
  const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(codeErr('BX_ABORTED')); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  return undefined;
});

function sizeCounter(limit, code, onBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (onBytes) onBytes(total);
      if (total > limit) return cb(codeErr(code, 'size limit exceeded'));
      return cb(null, chunk);
    },
  });
}

// ---- target (validated URL) -------------------------------------------------------------------------
function buildTarget(rawUrl, pathOverride) {
  let validated;
  try {
    validated = validateUpstreamUrl(rawUrl, { allowQuery: true, field: '/url' });
  } catch (err) {
    throw toOutboundError(Object.assign(new Error('blocked'), { code: 'EBLOCKEDADDRESS' }));
  }
  const { url, devAllowed } = validated;
  const hostname = stripBrackets(url.hostname);
  if (!devAllowed && net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw toOutboundError(Object.assign(new Error('blocked'), { code: 'EBLOCKEDADDRESS' }));
  }
  return {
    url,
    devAllowed,
    hostname,
    protocol: url.protocol,
    port: portOf(url),
    path: pathOverride !== undefined ? pathOverride : `${url.pathname}${url.search}` || '/',
    origin: url.origin,
  };
}

// ---- one attempt ------------------------------------------------------------------------------------
/**
 * Sends one request. Resolves with { status, headers, stream } (stream mode) or { status, headers, body }
 * (buffer mode). Rejects with a raw error carrying a BX_* or Node `code`; the caller classifies it.
 */
function attemptOnce({ target, method, headers, body, signal, connectMs, responseMs, idleMs, bodyDeadlineMs, maxRequestBytes, maxResponseBytes, buffer, onRequestBytes }) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(codeErr('BX_ABORTED'));

    let phase = 'request'; // request -> response (headers received) -> done
    let req;
    let upRes;
    const timers = [];
    const clearTimers = () => { timers.forEach(clearTimeout); timers.length = 0; };

    const finish = () => { // releases every resource this attempt holds
      clearTimers();
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const failNow = (err) => {
      if (phase === 'done') return;
      phase = 'done';
      finish();
      try { if (upRes) upRes.destroy(); } catch { /* already closed */ }
      try { if (req) req.destroy(); } catch { /* already closed */ }
      reject(err);
    };
    function onAbort() {
      if (phase === 'response' && upRes && !buffer) {
        // Streaming response already handed to the caller: stop talking to the upstream.
        try { upRes.destroy(); } catch { /* noop */ }
        try { req.destroy(); } catch { /* noop */ }
        finish();
        phase = 'done';
        return;
      }
      failNow(codeErr('BX_ABORTED'));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const isHttps = target.protocol === 'https:';
    try {
      req = (isHttps ? https : http).request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method,
        path: target.path,
        headers,
        agent: getAgents()[target.protocol],
        lookup: guardedLookup(target.devAllowed),
      });
    } catch (err) {
      finish();
      return reject(err);
    }

    timers.push(setTimeout(() => failNow(codeErr('BX_TIMEOUT')), responseMs));

    req.on('socket', (socket) => {
      if (socket.connecting) {
        const t = setTimeout(() => failNow(codeErr('BX_CONNECT_TIMEOUT')), connectMs);
        timers.push(t);
        socket.once(isHttps ? 'secureConnect' : 'connect', () => clearTimeout(t));
      }
    });

    req.on('error', (err) => {
      if (phase === 'response') return; // mid-response failures are reported through the response stream
      failNow(err);
    });

    req.on('response', (res) => {
      if (phase !== 'request') { res.destroy(); return; }
      upRes = res;
      phase = 'response';
      clearTimers();

      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        return failNow(codeErr('BX_RESPONSE_TOO_LARGE'));
      }

      if (!buffer) {
        // Streaming: the caller pipes `stream`; idle timeout guards stalled upstreams.
        res.setTimeout(idleMs, () => res.destroy(codeErr('BX_TIMEOUT')));
        res.on('close', finish);
        return resolve({ status: res.statusCode, headers: res.headers, stream: res });
      }

      // Buffered: the whole body must arrive before the overall deadline, never stalling for idleMs.
      timers.push(setTimeout(() => failNow(codeErr('BX_TIMEOUT')), bodyDeadlineMs));
      res.setTimeout(idleMs, () => failNow(codeErr('BX_TIMEOUT')));
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > maxResponseBytes) return failNow(codeErr('BX_RESPONSE_TOO_LARGE'));
        chunks.push(c);
        return undefined;
      });
      res.on('end', () => {
        if (phase === 'done') return;
        phase = 'done';
        finish();
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks, total) });
      });
      res.on('error', (err) => failNow(err));
      res.on('aborted', () => failNow(codeErr('ECONNRESET')));
      return undefined;
    });

    // ---- request body ----
    if (body === undefined || body === null) {
      if (onRequestBytes) onRequestBytes(0);
      req.end();
    } else if (body instanceof Readable) {
      const counter = sizeCounter(maxRequestBytes, 'BX_BODY_TOO_LARGE', onRequestBytes);
      counter.on('error', (err) => failNow(err));
      body.on('error', (err) => failNow(err));
      body.pipe(counter).pipe(req);
    } else {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      if (buf.length > maxRequestBytes) return failNow(codeErr('BX_BODY_TOO_LARGE'));
      if (onRequestBytes) onRequestBytes(buf.length);
      req.end(buf);
    }
    return undefined;
  });
}

// ---- failure verdict for the circuit breaker --------------------------------------------------------
function statusIsInfraFailure(status) {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function safeTarget(target) {
  return `${target.origin}${String(target.path).split('?')[0]}`.slice(0, 300);
}

// ---- the engine -------------------------------------------------------------------------------------
async function execute(opts, mode) {
  const buffer = mode === 'buffer';
  const method = String(opts.method || 'GET').toUpperCase();
  const timeouts = {
    connectMs: opts.timeouts && opts.timeouts.connectMs || env.OUTBOUND_CONNECT_TIMEOUT_MS,
    responseMs: opts.timeouts && opts.timeouts.responseMs || env.OUTBOUND_RESPONSE_TIMEOUT_MS,
    idleMs: opts.timeouts && opts.timeouts.idleMs || env.OUTBOUND_IDLE_TIMEOUT_MS,
    totalMs: opts.timeouts && opts.timeouts.totalMs || env.OUTBOUND_TOTAL_TIMEOUT_MS,
  };
  const limits = {
    maxRequestBytes: opts.limits && opts.limits.maxRequestBytes || env.OUTBOUND_MAX_REQUEST_BYTES,
    maxResponseBytes: opts.limits && opts.limits.maxResponseBytes || env.OUTBOUND_MAX_RESPONSE_BYTES,
  };
  const policy = resolvePolicy(opts.retry || {});
  const sleep = opts.sleep || defaultSleep;
  const random = opts.random || Math.random;
  const now = opts.now || Date.now;
  const breakerCfg = opts.breaker === false || !env.BREAKER_ENABLED ? null : (opts.breaker || {});
  const breakerImpl = opts.breakerImpl || sharedBreaker;
  const followRedirects = (method === 'GET' || method === 'HEAD') ? Math.min(opts.maxRedirects !== undefined ? opts.maxRedirects : 0, env.OUTBOUND_MAX_REDIRECTS) : 0;
  const replayable = opts.body === undefined || opts.body === null || !(opts.body instanceof Readable);
  const started = now();
  const deadline = started + timeouts.totalMs;

  let target = buildTarget(opts.url, opts.path);
  const breakerKey = (breakerCfg && breakerCfg.key) || target.origin;

  const meta = {
    label: opts.label || 'outbound', method, target: safeTarget(target), correlationId: opts.correlationId || null,
    attempts: 0, retries: 0, retryDelayMs: 0, redirects: 0, breakerKey: breakerCfg ? breakerKey : null, breakerState: null,
    timedOut: false, circuitOpen: false, requestBytes: 0, upstreamStatus: null, upstreamMs: null, totalMs: 0,
    attemptLog: [],
  };
  const finalizeMeta = () => { meta.totalMs = now() - started; return meta; };

  const baseHeaders = { ...(opts.headers || {}) };
  const lower = Object.fromEntries(Object.keys(baseHeaders).map((k) => [k.toLowerCase(), k]));
  if (opts.correlationId && !lower['x-correlation-id']) baseHeaders['x-correlation-id'] = opts.correlationId;
  if (!lower['user-agent']) baseHeaders['user-agent'] = 'BridgeX/1.0';
  if (buffer && !lower['accept-encoding']) baseHeaders['accept-encoding'] = 'identity'; // never decode untrusted compressed bodies
  let headers = baseHeaders;

  const throwFinal = (err) => {
    const e = toOutboundError(err);
    e.meta = finalizeMeta();
    if (e.category === 'upstream_timeout' || e.category === 'upstream_connect_timeout') meta.timedOut = true;
    throw e;
  };

  for (;;) {
    // ---- circuit breaker gate (before EVERY attempt, so retries stop the moment a circuit opens) ----
    let lease = null;
    if (breakerCfg) {
      lease = await breakerImpl.acquire(breakerKey, breakerCfg);
      meta.breakerState = lease.state;
      if (!lease.allowed) {
        meta.circuitOpen = true;
        const e = circuitOpenError(breakerKey, lease.retryAfterMs, lease.state);
        e.meta = finalizeMeta();
        logger.warn('outbound_rejected_circuit_open', { label: meta.label, correlationId: meta.correlationId, breakerKey, target: meta.target, attempts: meta.attempts });
        throw e;
      }
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      if (lease) await lease.cancel();
      meta.timedOut = true;
      return throwFinal(codeErr('BX_TIMEOUT', 'deadline exceeded'));
    }

    meta.attempts += 1;
    const attemptNo = meta.attempts;
    const t0 = now();
    let res = null;
    let err = null;
    try {
      res = await attemptOnce({
        target, method, headers, body: opts.body, signal: opts.signal,
        connectMs: Math.min(timeouts.connectMs, remaining),
        responseMs: Math.min(timeouts.responseMs, remaining),
        idleMs: timeouts.idleMs,
        bodyDeadlineMs: remaining,
        maxRequestBytes: limits.maxRequestBytes,
        maxResponseBytes: limits.maxResponseBytes,
        buffer,
        onRequestBytes: (n) => { meta.requestBytes = n; },
      });
    } catch (e) {
      err = toOutboundError(e);
    }
    const attemptMs = now() - t0;

    // ---- verdict for the breaker ----
    if (lease) {
      if (err) {
        if (err.category === 'client_aborted') await lease.cancel();
        else if (err.countsAsFailure) await lease.failure(err.category);
        else await lease.cancel();
      } else if (statusIsInfraFailure(res.status)) await lease.failure(`status_${res.status}`);
      else await lease.success();
    }

    const entry = { attempt: attemptNo, ms: attemptMs, outcome: err ? err.category : `status_${res.status}` };
    if (err && err.category.includes('timeout')) meta.timedOut = true;
    if (res) { meta.upstreamStatus = res.status; meta.upstreamMs = attemptMs; }

    // ---- redirects (opt-in, GET/HEAD only, never a downgrade, always re-validated) ----
    if (res && REDIRECT_STATUSES.has(res.status) && res.headers.location) {
      if (followRedirects === 0) {
        meta.attemptLog.push(entry);
        return finish(res);
      }
      discard(res);
      if (meta.redirects >= followRedirects) return throwFinal(codeErr('BX_REDIRECT_BLOCKED'));
      let next;
      try {
        const loc = new URL(String(res.headers.location), target.url);
        if (target.protocol === 'https:' && loc.protocol !== 'https:') throw codeErr('BX_REDIRECT_BLOCKED');
        next = buildTarget(loc.toString());
      } catch {
        return throwFinal(codeErr('BX_REDIRECT_BLOCKED'));
      }
      if (next.origin !== target.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase())));
      }
      meta.redirects += 1;
      meta.attempts -= 1; // a redirect hop is not a retry
      meta.attemptLog.push({ ...entry, outcome: `redirect_${res.status}` });
      target = next;
      continue;
    }

    // ---- retry decision ----
    const decision = evaluateRetry({
      attempt: attemptNo, policy, method, headers, replayable, err: err || undefined, status: res ? res.status : undefined,
    });
    let delay = 0;
    let retry = decision.retry;
    let stopReason = decision.reason;
    if (retry) {
      delay = backoffDelay(attemptNo, policy, random);
      if (res) {
        const ra = parseRetryAfter(res.headers['retry-after'], now());
        if (ra !== null) {
          if (ra > policy.maxRetryAfterMs) { retry = false; stopReason = 'retry_after_too_long'; }
          else delay = Math.max(delay, ra);
        }
      }
      if (retry && now() + delay >= deadline) { retry = false; stopReason = 'deadline'; }
    }

    if (retry) {
      entry.willRetryInMs = delay;
      meta.attemptLog.push(entry);
      meta.retries += 1;
      meta.retryDelayMs += delay;
      if (res) discard(res);
      logger.warn('outbound_retry', {
        label: meta.label, correlationId: meta.correlationId, target: meta.target, attempt: attemptNo, nextDelayMs: delay,
        reason: decision.reason, status: res ? res.status : null, category: err ? err.category : null,
      });
      try {
        await sleep(delay, opts.signal);
      } catch (e) {
        return throwFinal(e);
      }
      continue;
    }

    // ---- final outcome ----
    entry.stop = stopReason;
    meta.attemptLog.push(entry);
    if (err) {
      if (meta.attempts > 1 || err.category !== 'client_aborted') {
        logger.warn('outbound_failed', { label: meta.label, correlationId: meta.correlationId, target: meta.target, attempts: meta.attempts, category: err.category, stop: stopReason });
      }
      return throwFinal(err);
    }
    return finish(res);
  }

  function finish(res) {
    finalizeMeta();
    if (buffer) {
      return {
        status: res.status, headers: res.headers, body: res.body, meta,
        text() { return res.body.toString('utf8'); },
        json() { return JSON.parse(res.body.toString('utf8')); },
      };
    }
    return { status: res.status, headers: res.headers, stream: res.stream, meta };
  }

  function discard(res) {
    if (res.stream) {
      res.stream.on('error', () => {});
      res.stream.destroy();
    }
  }
}

/** Sends a request and returns the fully buffered response: { status, headers, body, text(), json(), meta }. */
function request(opts) { return execute(opts, 'buffer'); }
/** Sends a request and resolves at the response headers: { status, headers, stream, meta }. */
function requestStream(opts) { return execute(opts, 'stream'); }

module.exports = { request, requestStream, closeAgents, getAgents, buildTarget, statusIsInfraFailure };
