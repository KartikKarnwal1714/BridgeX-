// Shared helpers that turn a stored integration row into outbound-client options. Used by the
// REST connection test, GraphQL forwarding and SOAP, so all three get identical timeout, retry,
// circuit-breaker, credential and secret-handling behaviour.
const env = require('../config/env');
const { ApiError } = require('../utils/response');
const { decrypt } = require('../utils/secretBox');
const { validateUpstreamUrl } = require('../utils/ssrf');
const logger = require('../utils/logger');

function notConfigured(message) {
  return new ApiError(409, 'INTEGRATION_NOT_CONFIGURED', message);
}

/** The integration's endpoint as a validated absolute URL, or a 409 explaining what to fix. */
function requireEndpoint(integration) {
  if (!/^https?:\/\//i.test(String(integration.endpoint || ''))) {
    throw notConfigured('This integration has no absolute http(s) endpoint URL configured.');
  }
  try {
    return validateUpstreamUrl(integration.endpoint, { allowQuery: true, field: '/endpoint' }).url;
  } catch (err) {
    throw notConfigured('The integration endpoint is not permitted (private, local or malformed address).');
  }
}

/** Decrypted credential header for this integration, or null. Never logged, never returned. */
function credentialHeader(integration) {
  if (!integration.auth_mode || integration.auth_mode === 'none' || !integration.credential_enc) return null;
  let secret;
  try {
    secret = decrypt(integration.credential_enc);
  } catch {
    logger.error('Integration credential could not be decrypted', { integrationId: integration.id });
    throw new ApiError(500, 'GATEWAY_MISCONFIGURED', 'This integration is not configured correctly');
  }
  return integration.auth_mode === 'bearer'
    ? { name: 'authorization', value: `Bearer ${secret}` }
    : { name: String(integration.auth_header || 'x-api-key').toLowerCase(), value: secret };
}

function timeoutsFor(integration) {
  const responseMs = Math.min(integration.timeout_ms || env.OUTBOUND_RESPONSE_TIMEOUT_MS, env.GATEWAY_MAX_TIMEOUT_MS);
  return {
    connectMs: Math.min(env.OUTBOUND_CONNECT_TIMEOUT_MS, responseMs),
    responseMs,
    idleMs: responseMs,
    totalMs: Math.max(responseMs, env.OUTBOUND_TOTAL_TIMEOUT_MS),
  };
}

function breakerFor(integration) {
  return { key: `integration:${integration.id}` };
}

module.exports = { requireEndpoint, credentialHeader, timeoutsFor, breakerFor, notConfigured };
