const integrationModel = require('../models/integrationModel');
const { ApiError } = require('../utils/response');
const { validateUpstreamUrl } = require('../utils/ssrf');
const { encrypt } = require('../utils/secretBox');
const { FORBIDDEN_FORWARD_HEADERS } = require('../gateway/headers');
const protocols = require('../integrations/protocols');
const soapService = require('../soap/soapService');
const upstream = require('../integrations/upstream');

// A stored Connected value is only trustworthy if a real verification wrote it (last_verified_at set).
// Legacy rows (from before verification existed) keep their data but are shown as Unverified.
function presentIntegration(integration) {
  if (!integration) return integration;
  const row = { ...integration };
  delete row.credential_enc; // defence in depth: never serialise ciphertext
  if (row.status === 'Connected' && !row.last_verified_at) row.status = 'Unverified';
  return row;
}

function invalid(field, message) {
  return new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', [{ field: `/${field}`, message }]);
}
function originOf(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return null; }
}

// Cross-field rules that need the stored values too. Only enforced for absolute http(s) endpoints,
// because older registry-style integrations legitimately hold relative paths like "/crm".
function validateMerged(merged, { hasCredential }) {
  const endpoint = String(merged.endpoint || '');
  if (/^https?:\/\//i.test(endpoint)) {
    validateUpstreamUrl(endpoint, { allowQuery: true, field: '/endpoint' });
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(endpoint)) {
    // file:, ftp:, gopher:, data:, javascript: ... are never a valid integration endpoint. (Relative values such
    // as "/crm", accepted since Phase 4, cannot be called and are reported as "not configured" on verification.)
    throw invalid('endpoint', 'must be an http:// or https:// URL');
  }
  if (merged.config && merged.config.wsdlUrl) validateUpstreamUrl(merged.config.wsdlUrl, { allowQuery: true, field: '/config/wsdlUrl' });
  if (merged.auth_mode === 'header') {
    if (!merged.auth_header) throw invalid('auth_header', 'is required when auth_mode is "header"');
    const lower = merged.auth_header.toLowerCase();
    if (FORBIDDEN_FORWARD_HEADERS.has(lower) && lower !== 'authorization') throw invalid('auth_header', 'is not an allowed header name');
  }
  if (merged.auth_mode && merged.auth_mode !== 'none' && !hasCredential) {
    throw invalid('credential', `is required when auth_mode is "${merged.auth_mode}"`);
  }
}

function toColumns(body) {
  const cols = { ...body };
  delete cols.credential;
  if (body.credential !== undefined) cols.credential_enc = body.credential === null ? null : encrypt(body.credential);
  return cols;
}

async function listIntegrations() {
  return (await integrationModel.findAll()).map(presentIntegration);
}

async function getIntegration(id) {
  const integration = await integrationModel.findById(id);
  if (!integration) throw new ApiError(404, 'NOT_FOUND', 'Integration not found');
  return presentIntegration(integration);
}

async function createIntegration(payload) {
  validateMerged({ auth_mode: 'none', ...payload }, { hasCredential: Boolean(payload.credential) });
  return presentIntegration(await integrationModel.create(toColumns(payload)));
}

async function updateIntegration(id, fields) {
  const existing = await integrationModel.findByIdWithSecret(id);
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Integration not found');

  const merged = { ...existing, ...fields };
  const hasCredential = fields.credential !== undefined ? Boolean(fields.credential) : Boolean(existing.credential_enc);
  if (
    fields.endpoint !== undefined && originOf(fields.endpoint) !== originOf(existing.endpoint) &&
    existing.credential_enc && fields.credential === undefined
  ) {
    throw invalid('credential', 'must be provided again when the endpoint host changes');
  }
  validateMerged(merged, { hasCredential });
  return presentIntegration(await integrationModel.update(id, toColumns(fields)));
}

async function deleteIntegration(id) {
  const existing = await integrationModel.findById(id);
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Integration not found');
  await integrationModel.remove(id);
}

async function loadWithSecret(id) {
  const integration = await integrationModel.findByIdWithSecret(id);
  if (!integration) throw new ApiError(404, 'NOT_FOUND', 'Integration not found');
  return integration;
}

/** Real connection check; stores the result (status, time, error) on the integration. */
async function verifyIntegration(id, ctx = {}) {
  const integration = await loadWithSecret(id);
  const outcome = await protocols.runVerification(integration, ctx);
  const status = outcome.ok ? 'Connected' : 'Error';
  const saved = await integrationModel.recordVerification(id, {
    status, error: outcome.ok ? null : `${outcome.error.code}: ${outcome.error.message}`, ms: outcome.latencyMs,
  });
  return {
    integrationId: Number(id),
    protocol: integration.protocol,
    status,
    checkedAt: new Date(saved.last_verified_at).toISOString(),
    latencyMs: outcome.latencyMs,
    ...(outcome.ok ? { details: outcome.details } : { error: outcome.error }),
    meta: outcome.meta,
  };
}

async function listSoapOperations(id, ctx = {}) {
  const integration = await loadWithSecret(id);
  if (integration.protocol !== 'SOAP') throw new ApiError(409, 'INTEGRATION_PROTOCOL_MISMATCH', 'This integration is not a SOAP integration.');
  const loaded = await soapService.loadWsdl(integration, ctx);
  return { service: loaded.service, port: loaded.port, wsdlUrl: loaded.wsdlUrl, operations: loaded.operations };
}

async function invokeGraphql(id, body, ctx = {}) {
  return protocols.forwardGraphql(await loadWithSecret(id), body, ctx);
}

async function invokeSoap(id, body, ctx = {}) {
  const integration = await loadWithSecret(id);
  if (integration.protocol !== 'SOAP') throw new ApiError(409, 'INTEGRATION_PROTOCOL_MISMATCH', 'This integration is not a SOAP integration.');
  return soapService.invoke(integration, { operation: body.operation, args: body.arguments || {}, soapHeaders: body.soapHeaders || [] }, ctx);
}

module.exports = {
  listIntegrations, getIntegration, createIntegration, updateIntegration, deleteIntegration,
  verifyIntegration, listSoapOperations, invokeGraphql, invokeSoap, presentIntegration,
};
