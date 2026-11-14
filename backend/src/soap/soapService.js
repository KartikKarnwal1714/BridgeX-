// Real SOAP/WSDL support built on node-soap (maintained). BridgeX owns everything security-relevant:
//
//  * Transport: node-soap is given a custom httpClient that sends EVERY request - the WSDL, its imports
//    and the SOAP call itself - through the shared outbound client (SSRF guard, timeouts, size limits,
//    retry rules, circuit breaker, cancellation). node-soap's own axios client is never used.
//  * WSDL imports: a hook validates every import/include location before it is fetched: http(s) only
//    (no file:, no relative-to-disk reads), same origin as the WSDL, at most SOAP_WSDL_MAX_IMPORTS.
//  * XML: any document containing a DOCTYPE or ENTITY declaration is refused (WSDL/XSD/SOAP never need
//    one), which removes XXE and entity-expansion ("billion laughs") attacks before parsing begins.
//  * Endpoint: the address inside the WSDL is IGNORED. Calls go to the endpoint an administrator
//    configured, so a hostile WSDL cannot redirect traffic to an internal host.
//  * Secrets: credentials are applied only to the configured WSDL/endpoint origins, and every error text
//    is passed through redactText before it is logged.
const soap = require('soap');
const env = require('../config/env');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/response');
const outbound = require('../outbound/client');
const { OutboundError, toOutboundError } = require('../outbound/errors');
const { validateUpstreamUrl } = require('../utils/ssrf');
const { redactText } = require('../utils/redactSecrets');
const upstream = require('../integrations/upstream');

const DTD_RE = /<!\s*(DOCTYPE|ENTITY)/i;
const cache = new Map(); // key -> { at, entry }
const MAX_CACHE = 50;

class SoapFaultError extends ApiError {
  constructor(fault) {
    super(502, 'SOAP_FAULT', 'The SOAP service returned a fault.', [{ field: 'fault', message: fault.reason || 'SOAP fault', code: fault.code || null, detail: fault.detail || undefined }]);
    this.name = 'SoapFaultError';
    this.category = 'soap_fault';
    this.outcome = 'upstream_error';
    this.fault = fault;
  }
}

const soapError = (status, code, message, category) => Object.assign(new ApiError(status, code, message), { category, outcome: 'gateway_error' });

// ---- transport adapter: node-soap -> shared outbound client ----------------------------------------
function createHttpClient({ integration, ctx, rootUrl, kind }) {
  const endpointUrl = new URL(integration.endpoint);
  const trustedOrigins = new Set([endpointUrl.origin, rootUrl ? new URL(rootUrl).origin : endpointUrl.origin]);
  const cred = upstream.credentialHeader(integration);
  const soapIdempotent = Boolean(integration.config && integration.config.soapIdempotent);
  const timeouts = upstream.timeoutsFor(integration);

  return {
    request(rurl, data, callback, exheaders) {
      const isCall = data !== null && data !== undefined;
      const headers = {};
      for (const [k, v] of Object.entries(exheaders || {})) {
        const lk = k.toLowerCase();
        if (['connection', 'content-length', 'host', 'transfer-encoding', 'authorization', 'cookie'].includes(lk)) continue;
        if (v !== undefined && v !== null) headers[lk] = String(v);
      }
      let origin;
      try { origin = new URL(rurl).origin; } catch { origin = null; }
      if (cred && origin && trustedOrigins.has(origin)) headers[cred.name] = cred.value;
      if (!isCall) headers.accept = headers.accept || 'text/xml, application/xml, application/wsdl+xml, */*;q=0.1';

      outbound.request({
        label: isCall ? 'soap' : 'wsdl',
        url: rurl,
        method: isCall ? 'POST' : 'GET',
        headers,
        body: isCall ? String(data) : undefined,
        signal: ctx.signal,
        correlationId: ctx.correlationId,
        timeouts,
        limits: {
          maxResponseBytes: isCall ? env.SOAP_MAX_RESPONSE_BYTES : env.SOAP_WSDL_MAX_BYTES,
          maxRequestBytes: env.OUTBOUND_MAX_REQUEST_BYTES,
        },
        // A SOAP call is a POST: it is only retried if the integration declares its operations idempotent.
        retry: isCall ? { idempotent: soapIdempotent } : {},
        maxRedirects: isCall ? 0 : env.OUTBOUND_MAX_REDIRECTS,
        breaker: upstream.breakerFor(integration),
      }).then((res) => {
        const text = res.text();
        if (DTD_RE.test(text)) {
          return callback(Object.assign(new Error('xml dtd forbidden'), { code: 'BX_XML_DTD_FORBIDDEN' }));
        }
        if (res.status >= 400) {
          return callback(Object.assign(new Error(`HTTP ${res.status}`), { response: { status: res.status, data: text, headers: res.headers }, config: { headers } }));
        }
        return callback(null, { status: res.status, headers: res.headers, data: text, config: { headers } }, text);
      }).catch((err) => callback(err));
    },
  };
}

// ---- WSDL import policy ----------------------------------------------------------------------------
function importGuard(rootUrl) {
  const rootOrigin = new URL(rootUrl).origin;
  let count = 0;
  return (includePath, _base, location) => {
    count += 1;
    const block = (why) => Object.assign(new Error(`WSDL import blocked: ${why}`), { code: 'BX_WSDL_IMPORT_BLOCKED' });
    if (count > env.SOAP_WSDL_MAX_IMPORTS) throw block('too many imports');
    let u;
    try { u = new URL(includePath); } catch { throw block('not an absolute URL'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw block('only http(s) imports are allowed');
    if (u.origin !== rootOrigin) throw block('imports must come from the same host as the WSDL');
    try { validateUpstreamUrl(includePath, { allowQuery: true, field: '/import' }); } catch { throw block('address not permitted'); }
    if (location === undefined) throw block('missing location');
    return includePath;
  };
}

function wsdlUrlFor(integration) {
  const raw = (integration.config && integration.config.wsdlUrl) || (/^https?:\/\//i.test(integration.endpoint || '') ? `${integration.endpoint}${String(integration.endpoint).includes('?') ? '&' : '?'}wsdl` : null);
  if (!raw) throw upstream.notConfigured('This SOAP integration needs a WSDL URL (config.wsdlUrl).');
  try {
    return validateUpstreamUrl(raw, { allowQuery: true, field: '/config/wsdlUrl' }).url.toString();
  } catch {
    throw upstream.notConfigured('The WSDL URL is not permitted (private, local or malformed address).');
  }
}

function mapLoadError(err) {
  if (err instanceof OutboundError) return err;
  if (err && err.code === 'BX_WSDL_IMPORT_BLOCKED') return soapError(502, 'SOAP_INVALID_WSDL', 'The WSDL references an import that is not permitted.', 'wsdl_import_blocked');
  if (err && err.code === 'BX_XML_DTD_FORBIDDEN') return soapError(502, 'SOAP_INVALID_WSDL', 'The WSDL contains a DOCTYPE/ENTITY declaration, which is not permitted.', 'wsdl_dtd_forbidden');
  if (err && err.response && err.response.status) return soapError(502, 'SOAP_INVALID_WSDL', `The WSDL could not be downloaded (upstream status ${err.response.status}).`, 'wsdl_fetch_failed');
  if (err && (err.code && /^(BX_|E[A-Z]+$|ERR_|CERT_|UNABLE_)/.test(String(err.code)))) return toOutboundError(err);
  return soapError(502, 'SOAP_INVALID_WSDL', 'The document is not a usable WSDL.', 'wsdl_invalid');
}

// ---- loading + describing -------------------------------------------------------------------------
function versionOf(integration) {
  return integration.config && integration.config.soapVersion === '1.2' ? '1.2' : '1.1';
}

function cacheKey(integration, wsdlUrl) {
  return `${integration.id}|${wsdlUrl}|${versionOf(integration)}|${integration.updated_at ? new Date(integration.updated_at).getTime() : 0}`;
}

function listOperations(client, integration) {
  const desc = client.describe();
  const endpoint = integration.endpoint.replace(/\/+$/, '');
  const services = client.wsdl.definitions.services || {};
  let chosen = null;
  for (const [svcName, svc] of Object.entries(services)) {
    for (const [portName, port] of Object.entries(svc.ports || {})) {
      const loc = String((port.location || '')).replace(/\/+$/, '');
      if (!chosen || loc === endpoint) chosen = { service: svcName, port: portName };
      if (loc === endpoint) break;
    }
  }
  if (!chosen) throw soapError(502, 'SOAP_INVALID_WSDL', 'The WSDL defines no usable service port.', 'wsdl_no_port');
  const ops = desc[chosen.service][chosen.port];
  const bindingOps = client.wsdl.definitions.services[chosen.service].ports[chosen.port].binding.methods || {};
  return {
    service: chosen.service,
    port: chosen.port,
    operations: Object.entries(ops).map(([name, io]) => ({
      name,
      soapAction: bindingOps[name] && bindingOps[name].soapAction !== undefined ? bindingOps[name].soapAction : null,
      input: io.input || {},
      output: io.output || {},
    })),
  };
}

/**
 * Downloads and parses the WSDL (cached for SOAP_WSDL_CACHE_TTL_MS). Returns { client, service, port, operations }.
 */
async function loadWsdl(integration, ctx = {}, { forceRefresh = false } = {}) {
  upstream.requireEndpoint(integration);
  const wsdlUrl = wsdlUrlFor(integration);
  const key = cacheKey(integration, wsdlUrl);
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.at < env.SOAP_WSDL_CACHE_TTL_MS) return hit.entry;

  const httpClient = createHttpClient({ integration, ctx, rootUrl: wsdlUrl, kind: 'wsdl' });
  let client;
  try {
    client = await soap.createClientAsync(wsdlUrl, {
      httpClient,
      endpoint: integration.endpoint,
      forceSoap12Headers: versionOf(integration) === '1.2',
      wsdl_options: { httpClient, overrideImportLocation: importGuard(wsdlUrl) },
    });
  } catch (err) {
    throw mapLoadError(err);
  }
  let described;
  try {
    described = listOperations(client, integration);
  } catch (err) {
    throw err instanceof ApiError ? err : soapError(502, 'SOAP_INVALID_WSDL', 'The document is not a usable WSDL.', 'wsdl_invalid');
  }
  const entry = { wsdl: client.wsdl, wsdlUrl, ...described };
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), entry });
  return entry;
}

// ---- faults ---------------------------------------------------------------------------------------
function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v.$value !== undefined) return text(v.$value);
  if (v.Text !== undefined) return text(v.Text);
  return '';
}

function extractFault(err) {
  const body = err && err.root && err.root.Envelope && err.root.Envelope.Body;
  const f = body && body.Fault;
  if (!f) return null;
  const code = f.faultcode !== undefined ? text(f.faultcode) : text(f.Code && f.Code.Value);
  const reason = f.faultstring !== undefined ? text(f.faultstring) : text(f.Reason);
  let detail = f.detail !== undefined ? f.detail : f.Detail;
  if (detail !== undefined) detail = redactText(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 1000);
  return { code: redactText(code).slice(0, 100), reason: redactText(reason).slice(0, 500), detail };
}

// ---- invoking -------------------------------------------------------------------------------------
async function invoke(integration, { operation, args = {}, soapHeaders = [] }, ctx = {}) {
  const loaded = await loadWsdl(integration, ctx);
  const known = loaded.operations.find((o) => o.name === operation);
  if (!known) {
    throw new ApiError(400, 'SOAP_UNKNOWN_OPERATION', `Operation "${String(operation).slice(0, 80)}" is not defined by the WSDL.`, [{ field: '/operation', message: 'unknown operation', allowed: loaded.operations.map((o) => o.name) }]);
  }

  // A fresh Client per call: SOAP headers are per-client state and must never leak between requests.
  const httpClient = createHttpClient({ integration, ctx, rootUrl: loaded.wsdlUrl, kind: 'call' });
  const client = new soap.Client(loaded.wsdl, integration.endpoint, { httpClient, endpoint: integration.endpoint, forceSoap12Headers: versionOf(integration) === '1.2' });
  client.setEndpoint(integration.endpoint);
  soapHeaders.forEach((h, i) => client.addSoapHeader(h.value, h.name, `h${i}`, h.namespace));

  const started = Date.now();
  const method = client[loaded.service][loaded.port][operation];
  let result; let rawEnvelope;
  try {
    [result, rawEnvelope] = await new Promise((resolve, reject) => {
      method(args, (err, res, raw) => (err ? reject(err) : resolve([res, raw])), {});
    });
  } catch (err) {
    const fault = extractFault(err);
    if (fault) {
      logger.warn('soap_fault', { correlationId: ctx.correlationId, integrationId: integration.id, operation, faultCode: fault.code });
      throw new SoapFaultError(fault);
    }
    if (err instanceof OutboundError || err instanceof ApiError) throw err;
    if (err && err.code === 'BX_XML_DTD_FORBIDDEN') throw soapError(502, 'SOAP_INVALID_RESPONSE', 'The SOAP response contains a DOCTYPE/ENTITY declaration, which is not permitted.', 'soap_dtd_forbidden');
    if (err && err.response) throw soapError(502, 'SOAP_INVALID_RESPONSE', `The SOAP service answered with HTTP ${err.response.status} and no SOAP fault.`, 'soap_http_error');
    if (err && err.code && /^(BX_|E[A-Z]+$|ERR_)/.test(String(err.code))) throw toOutboundError(err);
    throw soapError(502, 'SOAP_INVALID_RESPONSE', 'The SOAP response could not be understood.', 'soap_invalid_response');
  }
  return {
    operation, soapVersion: versionOf(integration), result, durationMs: Date.now() - started,
    responseBytes: rawEnvelope ? Buffer.byteLength(String(rawEnvelope)) : null,
  };
}

function clearCache() { cache.clear(); }

module.exports = { loadWsdl, invoke, SoapFaultError, clearCache, wsdlUrlFor, extractFault };
