// BridgeX's own GraphQL schema. It is a second front door onto the SAME services the REST API uses, so
// validation, role checks, ownership checks and "never expose credentials" rules are shared, not copied.
const { buildSchema } = require('graphql');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { ApiError } = require('../utils/response');
const { breaker } = require('../outbound/circuitBreaker');
const apiService = require('../services/apiService');
const apiKeyService = require('../services/apiKeyService');
const authService = require('../services/authService');
const integrationService = require('../services/integrationService');
const { createIntegrationSchema, updateIntegrationSchema } = require('../schemas/integrationSchemas');

const typeDefs = /* GraphQL */ `
  "Integration protocol."
  enum Protocol { REST GRAPHQL SOAP }
  enum AuthMode { none bearer header }

  type User { id: Int! name: String! email: String! role: String! status: String }
  type Api {
    id: Int! name: String! description: String protocol: Protocol! baseUrl: String! status: String!
    requestCount: Float successRate: Float averageResponseTime: Int gatewaySlug: String gatewayEnabled: Boolean
  }
  type IntegrationConfig { wsdlUrl: String soapVersion: String healthPath: String soapIdempotent: Boolean }
  type Integration {
    id: Int! name: String! type: String! protocol: Protocol! endpoint: String! status: String!
    authMode: AuthMode! authHeader: String hasCredential: Boolean! timeoutMs: Int
    config: IntegrationConfig lastVerifiedAt: String lastVerificationError: String lastVerificationMs: Int
  }
  type Verification { integrationId: Int! status: String! checkedAt: String! latencyMs: Int! errorCode: String errorMessage: String }
  type ApiKey { id: Int! name: String! preview: String! environment: String! status: String! owner: String rateLimitPerMinute: Int apiIds: [Int!]! }
  type CircuitBreakerState { key: String! state: String! consecutiveFailures: Int! timesOpened: Int! openedAt: String lastError: String store: String! }
  type Health { status: String! service: String! }

  input IntegrationConfigInput { wsdlUrl: String soapVersion: String healthPath: String soapIdempotent: Boolean }
  input IntegrationInput {
    name: String! type: String! protocol: Protocol! endpoint: String!
    authMode: AuthMode authHeader: String credential: String timeoutMs: Int config: IntegrationConfigInput
  }
  input IntegrationPatch {
    name: String type: String protocol: Protocol endpoint: String
    authMode: AuthMode authHeader: String credential: String timeoutMs: Int config: IntegrationConfigInput
  }

  type Query {
    health: Health!
    me: User!
    apis(limit: Int = 50, offset: Int = 0): [Api!]!
    api(id: Int!): Api
    integrations(limit: Int = 50, offset: Int = 0): [Integration!]!
    integration(id: Int!): Integration
    apiKeys: [ApiKey!]!
    circuitBreakers: [CircuitBreakerState!]!
  }
  type Mutation {
    createIntegration(input: IntegrationInput!): Integration!
    updateIntegration(id: Int!, input: IntegrationPatch!): Integration!
    deleteIntegration(id: Int!): Boolean!
    verifyIntegration(id: Int!): Verification!
    revokeApiKey(id: Int!): ApiKey!
  }
`;

const schema = buildSchema(typeDefs);

// ---- helpers ---------------------------------------------------------------------------------------
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validators = { create: ajv.compile(createIntegrationSchema), update: ajv.compile(updateIntegrationSchema) };

function requireUser(ctx) {
  if (!ctx.user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  return ctx.user;
}
function requireRole(ctx, ...roles) {
  const user = requireUser(ctx);
  if (!roles.includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
  return user;
}
function clampPage({ limit = 50, offset = 0 }) {
  return { limit: Math.min(100, Math.max(1, limit)), offset: Math.max(0, offset) };
}
const page = (list, args) => { const { limit, offset } = clampPage(args); return list.slice(offset, offset + limit); };

const SNAKE = { authMode: 'auth_mode', authHeader: 'auth_header', timeoutMs: 'timeout_ms' };
function toIntegrationFields(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'credential') { out.credential = v; continue; }
    out[SNAKE[k] || k] = v;
  }
  // GraphQL cannot express "absent" vs null for nested objects; drop nulls from the config object.
  if (out.config) out.config = Object.fromEntries(Object.entries(out.config).filter(([, v]) => v !== null && v !== undefined));
  return out;
}
function validateFields(kind, fields) {
  const { credential, ...rest } = fields; // `credential` is validated by the service (write-only secret)
  if (!validators[kind]({ ...rest, ...(credential !== undefined ? { credential } : {}) })) {
    const details = (validators[kind].errors || []).map((e) => ({ field: e.instancePath || e.params.missingProperty || '(root)', message: e.message }));
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', details);
  }
}

const presentApi = (a) => ({
  id: a.id, name: a.name, description: a.description, protocol: a.protocol, baseUrl: a.base_url, status: a.status,
  requestCount: Number(a.request_count), successRate: Number(a.success_rate), averageResponseTime: a.average_response_time,
  gatewaySlug: a.gateway_slug, gatewayEnabled: a.gateway_enabled,
});
const presentIntegration = (i) => ({
  id: i.id, name: i.name, type: i.type, protocol: i.protocol, endpoint: i.endpoint, status: i.status,
  authMode: i.auth_mode || 'none', authHeader: i.auth_header || null, hasCredential: Boolean(i.has_credential), timeoutMs: i.timeout_ms || null,
  config: i.config || {}, lastVerifiedAt: i.last_verified_at ? new Date(i.last_verified_at).toISOString() : null,
  lastVerificationError: i.last_verification_error || null, lastVerificationMs: i.last_verification_ms || null,
});
const presentKey = (k) => ({
  id: k.id, name: k.name, preview: k.preview, environment: k.environment, status: k.status, owner: k.owner || null,
  rateLimitPerMinute: k.rateLimitPerMinute, apiIds: k.apiIds || [],
});

// ---- root resolvers --------------------------------------------------------------------------------
const rootValue = {
  health: () => ({ status: 'healthy', service: 'BridgeX API' }),
  me: async (_a, ctx) => authService.getCurrentUser(requireUser(ctx).id),
  apis: async (args, ctx) => { requireUser(ctx); return page((await apiService.listApis()).map(presentApi), args); },
  api: async ({ id }, ctx) => { requireUser(ctx); try { return presentApi(await apiService.getApi(id)); } catch (e) { if (e.statusCode === 404) return null; throw e; } },
  integrations: async (args, ctx) => {
    requireRole(ctx, 'SUPER_ADMIN', 'DEVELOPER', 'SUPPORT');
    return page((await integrationService.listIntegrations()).map(presentIntegration), args);
  },
  integration: async ({ id }, ctx) => {
    requireRole(ctx, 'SUPER_ADMIN', 'DEVELOPER', 'SUPPORT');
    try { return presentIntegration(await integrationService.getIntegration(id)); } catch (e) { if (e.statusCode === 404) return null; throw e; }
  },
  apiKeys: async (_a, ctx) => (await apiKeyService.listKeys(requireUser(ctx))).map(presentKey),
  circuitBreakers: async (_a, ctx) => {
    requireRole(ctx, 'SUPER_ADMIN', 'DEVELOPER', 'SUPPORT');
    return (await breaker.list()).map((v) => ({ ...v, openedAt: v.openedAt, lastError: v.lastError }));
  },

  createIntegration: async ({ input }, ctx) => {
    requireRole(ctx, 'SUPER_ADMIN', 'DEVELOPER');
    const fields = toIntegrationFields(input);
    validateFields('create', fields);
    return presentIntegration(await integrationService.createIntegration(fields));
  },
  updateIntegration: async ({ id, input }, ctx) => {
    requireRole(ctx, 'SUPER_ADMIN');
    const fields = toIntegrationFields(input);
    validateFields('update', fields);
    return presentIntegration(await integrationService.updateIntegration(id, fields));
  },
  deleteIntegration: async ({ id }, ctx) => { requireRole(ctx, 'SUPER_ADMIN'); await integrationService.deleteIntegration(id); return true; },
  verifyIntegration: async ({ id }, ctx) => {
    requireRole(ctx, 'SUPER_ADMIN', 'DEVELOPER');
    const v = await integrationService.verifyIntegration(id, { signal: ctx.signal, correlationId: ctx.correlationId });
    return { integrationId: v.integrationId, status: v.status, checkedAt: v.checkedAt, latencyMs: v.latencyMs, errorCode: v.error ? v.error.code : null, errorMessage: v.error ? v.error.message : null };
  },
  revokeApiKey: async ({ id }, ctx) => {
    requireRole(ctx, 'SUPER_ADMIN', 'DEVELOPER');
    const row = await apiKeyService.patchKey(id, { status: 'revoked' }, ctx.user);
    return presentKey(row);
  },
};

module.exports = { schema, rootValue, typeDefs };
