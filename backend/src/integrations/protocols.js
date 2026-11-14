// Protocol-specific actions for a stored integration: connection verification (REST/GraphQL/SOAP),
// GraphQL forwarding. SOAP calls live in ../soap/soapService.js. All of them reach the network only
// through the shared outbound client.
const env = require('../config/env');
const { ApiError } = require('../utils/response');
const outbound = require('../outbound/client');
const { OutboundError } = require('../outbound/errors');
const { analyze, GraphqlRequestError } = require('../graphql/guard');
const { redactText } = require('../utils/redactSecrets');
const upstream = require('./upstream');
const soapService = require('../soap/soapService');

function baseOptions(integration, ctx, label) {
  const cred = upstream.credentialHeader(integration);
  return {
    label,
    headers: cred ? { [cred.name]: cred.value } : {},
    signal: ctx.signal,
    correlationId: ctx.correlationId,
    timeouts: upstream.timeoutsFor(integration),
    limits: { maxResponseBytes: env.OUTBOUND_MAX_RESPONSE_BYTES, maxRequestBytes: env.OUTBOUND_MAX_REQUEST_BYTES },
    breaker: upstream.breakerFor(integration),
  };
}

// ---- verification ---------------------------------------------------------------------------------
async function verifyRest(integration, ctx) {
  const base = upstream.requireEndpoint(integration);
  const healthPath = (integration.config && integration.config.healthPath) || '';
  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}${healthPath}${base.search}`;
  const res = await outbound.request({ ...baseOptions(integration, ctx, 'rest-verify'), url, method: 'GET', headers: { ...baseOptions(integration, ctx, 'rest-verify').headers, accept: 'application/json, */*;q=0.5' } });
  if (res.status >= 400) {
    throw Object.assign(new ApiError(502, 'UPSTREAM_ERROR', `The upstream answered with HTTP ${res.status}.`), { meta: res.meta });
  }
  return { upstreamStatus: res.status, attempts: res.meta.attempts };
}

async function verifyGraphql(integration, ctx) {
  const base = upstream.requireEndpoint(integration);
  const opts = baseOptions(integration, ctx, 'graphql-verify');
  const res = await outbound.request({
    ...opts,
    url: base.toString(),
    method: 'POST',
    headers: { ...opts.headers, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: 'query BridgeXVerify { __typename }', operationName: 'BridgeXVerify' }),
    retry: { idempotent: true }, // a query is safe to repeat
  });
  let json;
  try { json = res.json(); } catch { json = null; }
  if (res.status >= 400 || !json || typeof json !== 'object' || !json.data || typeof json.data.__typename !== 'string') {
    throw new ApiError(502, 'GRAPHQL_UPSTREAM_ERRORS', res.status >= 400 ? `The GraphQL endpoint answered with HTTP ${res.status}.` : 'The endpoint did not answer like a GraphQL server.');
  }
  return { upstreamStatus: res.status, rootType: json.data.__typename, attempts: res.meta.attempts };
}

async function verifySoap(integration, ctx) {
  const loaded = await soapService.loadWsdl(integration, ctx, { forceRefresh: true });
  return { service: loaded.service, port: loaded.port, operations: loaded.operations.length };
}

const VERIFIERS = { REST: verifyRest, GRAPHQL: verifyGraphql, SOAP: verifySoap };

/** Runs the protocol check. Never throws for an unhealthy upstream: returns { ok:false, error } instead. */
async function runVerification(integration, ctx) {
  const started = Date.now();
  try {
    const details = await VERIFIERS[integration.protocol](integration, ctx);
    return { ok: true, latencyMs: Date.now() - started, details };
  } catch (err) {
    if (err && err.category === 'client_aborted') throw err;
    if (err instanceof ApiError) {
      return { ok: false, latencyMs: Date.now() - started, error: { code: err.code, message: err.message }, meta: err.meta };
    }
    throw err;
  }
}

// ---- GraphQL forwarding ---------------------------------------------------------------------------
/**
 * Validates the request with the real GraphQL parser + limits, then forwards it to the integration's
 * GraphQL endpoint. Queries may be retried (idempotent); mutations never are.
 */
async function forwardGraphql(integration, { query, variables, operationName }, ctx) {
  if (integration.protocol !== 'GRAPHQL') {
    throw new ApiError(409, 'INTEGRATION_PROTOCOL_MISMATCH', 'This integration is not a GraphQL integration.');
  }
  const base = upstream.requireEndpoint(integration);
  let analysis;
  try {
    analysis = analyze({ query, variables, operationName });
  } catch (err) {
    if (err instanceof GraphqlRequestError) throw new ApiError(err.status, err.code, err.message, err.extensions && Object.keys(err.extensions).length ? [err.extensions] : []);
    throw err;
  }
  const opts = baseOptions(integration, ctx, 'graphql');
  const payload = { query, ...(variables ? { variables } : {}), ...(operationName ? { operationName } : {}) };
  let res;
  try {
    res = await outbound.request({
      ...opts,
      url: base.toString(),
      method: 'POST',
      headers: { ...opts.headers, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      retry: { idempotent: analysis.operation.type === 'query' },
    });
  } catch (err) {
    if (err instanceof OutboundError) err.operation = analysis.operation;
    throw err;
  }
  let json;
  try { json = res.json(); } catch { json = undefined; }
  const meta = { ...res.meta, operation: analysis.operation };

  if (res.status < 200 || res.status >= 300 || json === undefined || json === null || typeof json !== 'object' || Array.isArray(json)) {
    const messages = json && Array.isArray(json.errors) ? json.errors.slice(0, 5).map((e) => redactText(e && e.message).slice(0, 200)) : [];
    const err = new ApiError(502, json === undefined ? 'UPSTREAM_INVALID_RESPONSE' : 'GRAPHQL_UPSTREAM_ERRORS',
      json === undefined ? 'The upstream returned a response that is not JSON.' : 'The GraphQL upstream returned an error.',
      [{ field: 'upstream', status: res.status, errors: messages }]);
    err.meta = meta;
    err.category = 'graphql_upstream_error';
    err.outcome = 'upstream_error';
    throw err;
  }
  return { body: json, meta, status: res.status };
}

module.exports = { runVerification, forwardGraphql };
