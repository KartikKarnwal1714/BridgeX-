// Outbound failure model. One class, one mapping from raw Node/network errors to the BridgeX error
// catalog, so the REST gateway, GraphQL, SOAP and connection tests all report the same codes.
//
// Safe by construction: messages are fixed strings. The raw error (which can contain hostnames,
// IP addresses or request fragments) is kept only on the non-enumerable `cause` for server-side logs.
const { ApiError } = require('../utils/response');

class OutboundError extends ApiError {
  /**
   * @param {number} statusCode HTTP status BridgeX answers with
   * @param {string} code       catalog code
   * @param {string} message    safe message
   * @param {object} opts
   * @param {string} opts.category        fine-grained category stored in logs
   * @param {boolean} [opts.retryable]    transient failure worth retrying (subject to method safety)
   * @param {boolean} [opts.notDelivered] the request provably never reached the upstream
   * @param {boolean} [opts.countsAsFailure] counts toward opening the circuit breaker
   * @param {object} [opts.headers]       extra response headers (e.g. Retry-After, Connection)
   */
  constructor(statusCode, code, message, { category, retryable = false, notDelivered = false, countsAsFailure = false, headers = {}, outcome = 'gateway_error', details = [] } = {}) {
    super(statusCode, code, message, details);
    this.name = 'OutboundError';
    this.category = category || code.toLowerCase();
    this.retryable = retryable;
    this.notDelivered = notDelivered;
    this.countsAsFailure = countsAsFailure;
    this.headers = headers;
    this.outcome = outcome;
    this.meta = undefined;
  }
}

const MK = (status, code, message, o) => new OutboundError(status, code, message, o);

/** Maps any error thrown while talking to an upstream to an OutboundError. */
function toOutboundError(err) {
  if (err instanceof OutboundError) return err;
  const code = (err && (err.code || (err.errors && err.errors[0] && err.errors[0].code))) || '';
  const message = (err && err.message) || '';
  let out;

  if (code === 'BX_ABORTED') {
    out = MK(499, 'REQUEST_CANCELLED', 'The request was cancelled', { category: 'client_aborted', outcome: 'client_aborted' });
  } else if (code === 'BX_CONNECT_TIMEOUT') {
    out = MK(504, 'UPSTREAM_TIMEOUT', 'The upstream service did not respond in time', { category: 'upstream_connect_timeout', retryable: true, notDelivered: true, countsAsFailure: true });
  } else if (code === 'BX_TIMEOUT' || code === 'ETIMEDOUT') {
    out = MK(504, 'UPSTREAM_TIMEOUT', 'The upstream service did not respond in time', { category: 'upstream_timeout', retryable: true, countsAsFailure: true });
  } else if (code === 'BX_BODY_TOO_LARGE') {
    out = MK(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large', { category: 'payload_too_large', outcome: 'rejected', headers: { Connection: 'close' } });
  } else if (code === 'BX_RESPONSE_TOO_LARGE') {
    out = MK(502, 'UPSTREAM_RESPONSE_TOO_LARGE', 'The upstream response is too large', { category: 'upstream_response_too_large' });
  } else if (code === 'BX_REDIRECT_BLOCKED') {
    out = MK(502, 'UPSTREAM_REDIRECT_BLOCKED', 'The upstream redirect is not permitted', { category: 'upstream_redirect_blocked', notDelivered: false });
  } else if (code === 'EBLOCKEDADDRESS') {
    out = MK(502, 'UPSTREAM_ADDRESS_BLOCKED', 'The upstream address is not permitted', { category: 'upstream_blocked', notDelivered: true });
  } else if (code === 'EAI_AGAIN') {
    out = MK(502, 'UPSTREAM_DNS_FAILURE', 'The upstream host could not be resolved', { category: 'upstream_dns', retryable: true, notDelivered: true, countsAsFailure: true });
  } else if (code === 'ENOTFOUND') {
    out = MK(502, 'UPSTREAM_DNS_FAILURE', 'The upstream host could not be resolved', { category: 'upstream_dns', notDelivered: true, countsAsFailure: true });
  } else if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    out = MK(502, 'UPSTREAM_UNREACHABLE', 'The upstream service refused or could not accept the connection', { category: 'upstream_refused', retryable: true, notDelivered: true, countsAsFailure: true });
  } else if (code === 'ECONNRESET' || code === 'EPIPE' || /socket hang up/i.test(message)) {
    out = MK(502, 'UPSTREAM_CONNECTION_RESET', 'The upstream connection was closed unexpectedly', { category: 'upstream_reset', retryable: true, countsAsFailure: true });
  } else if (/^(CERT_|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|ERR_TLS|ERR_SSL|HOSTNAME_MISMATCH|ERR_OSSL)/.test(code) || /certificate/i.test(message)) {
    out = MK(502, 'UPSTREAM_TLS_ERROR', 'A secure connection to the upstream could not be established', { category: 'upstream_tls', countsAsFailure: true, notDelivered: true });
  } else if (/^HPE_/.test(code)) {
    out = MK(502, 'UPSTREAM_INVALID_RESPONSE', 'The upstream returned a malformed response', { category: 'upstream_invalid_response', countsAsFailure: true });
  } else if (code === 'ERR_INVALID_CHAR' || code === 'ERR_INVALID_HTTP_TOKEN') {
    out = MK(400, 'INVALID_REQUEST', 'Request contains invalid header characters', { category: 'invalid_request', outcome: 'rejected', notDelivered: true });
  } else if (err instanceof ApiError && err.statusCode === 400) {
    // URL validation failure raised by utils/ssrf before any connection was made.
    out = MK(502, 'UPSTREAM_ADDRESS_BLOCKED', 'The upstream address is not permitted', { category: 'upstream_blocked', notDelivered: true });
  } else {
    out = MK(502, 'UPSTREAM_ERROR', 'The upstream request failed', { category: 'upstream_error_other', countsAsFailure: true });
  }
  Object.defineProperty(out, 'cause', { value: err, enumerable: false });
  return out;
}

function circuitOpenError(key, retryAfterMs, state) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const e = MK(503, 'CIRCUIT_OPEN', 'The upstream service is temporarily unavailable. Please retry later.', {
    category: 'circuit_open',
    outcome: 'circuit_open',
    headers: { 'Retry-After': String(seconds) },
  });
  e.breakerKey = key;
  e.breakerState = state;
  return e;
}

module.exports = { OutboundError, toOutboundError, circuitOpenError };
