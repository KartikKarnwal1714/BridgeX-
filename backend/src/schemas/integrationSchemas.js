const env = require('../config/env');

const PROTOCOLS = ['REST', 'GRAPHQL', 'SOAP'];
// Clients may only ever store Error/Pending. "Connected" is written exclusively by a real connection
// check (POST /integrations/:id/verifications); legacy stored Connected rows are shown as Unverified.
const STATUSES = ['Error', 'Pending'];

// Protocol-specific settings, stored in the integration's JSONB `config`.
const configSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    wsdlUrl: { type: 'string', maxLength: 500, pattern: '^https?://[\\x21-\\x7e]+$' },
    soapVersion: { type: 'string', enum: ['1.1', '1.2'] },
    soapIdempotent: { type: 'boolean' }, // operations may be retried on transient failures
    healthPath: { type: 'string', maxLength: 200, pattern: '^/[\\x21-\\x7e]*$' }, // REST connection test path
  },
};

const properties = {
  name: { type: 'string', minLength: 2, maxLength: 150 },
  type: { type: 'string', minLength: 2, maxLength: 100 },
  protocol: { type: 'string', enum: PROTOCOLS },
  endpoint: { type: 'string', minLength: 1, maxLength: 300 },
  status: { type: 'string', enum: STATUSES },
  config: configSchema,
  auth_mode: { type: 'string', enum: ['none', 'bearer', 'header'] },
  auth_header: { type: ['string', 'null'], pattern: '^[A-Za-z0-9-]{1,100}$' },
  // Write-only. Stored encrypted (AES-256-GCM); never returned by any endpoint.
  credential: { type: ['string', 'null'], pattern: '^[\\x20-\\x7e]{1,2000}$' },
  timeout_ms: { type: ['integer', 'null'], minimum: 100, maximum: env.GATEWAY_MAX_TIMEOUT_MS },
};

const createIntegrationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'protocol', 'endpoint'],
  properties,
};

const updateIntegrationSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties,
};

const replaceIntegrationSchema = {
  ...updateIntegrationSchema,
  required: ['name', 'type', 'protocol', 'endpoint'],
};

// Body of POST /integrations/:id/graphql
const graphqlRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    variables: { type: ['object', 'null'] },
    operationName: { type: ['string', 'null'], maxLength: 200 },
  },
};

// Body of POST /integrations/:id/soap
const soapRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operation'],
  properties: {
    operation: { type: 'string', minLength: 1, maxLength: 200 },
    arguments: { type: 'object' },
    soapHeaders: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'value'],
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,100}$' },
          namespace: { type: 'string', maxLength: 300, pattern: '^[\\x21-\\x7e]+$' },
          value: { anyOf: [{ type: 'object' }, { type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        },
      },
    },
  },
};

module.exports = {
  createIntegrationSchema, updateIntegrationSchema, replaceIntegrationSchema, graphqlRequestSchema, soapRequestSchema,
};
