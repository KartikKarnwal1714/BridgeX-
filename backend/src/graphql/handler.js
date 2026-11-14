// HTTP transport for BridgeX's GraphQL endpoint (POST /api/v1/graphql, queries also via GET).
//
// Error model (documented in the OpenAPI file):
//   * Failures BEFORE execution (bad JSON, parse/validation errors, depth/complexity limits, 401/403/429)
//     return the proper HTTP status and a body that is BOTH the unified BridgeX envelope
//     ({success:false, error:{code,message,details,correlationId}}) AND a standard GraphQL `errors` array,
//     so REST-style and GraphQL-style clients can each read it.
//   * Failures DURING execution return HTTP 200 with `data` (possibly partial) and `errors`, per the
//     GraphQL spec. Each error carries extensions.code (same catalog) and extensions.correlationId.
const { validate, execute, specifiedRules, NoSchemaIntrospectionCustomRule } = require('graphql');
const env = require('../config/env');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/response');
const { buildErrorBody } = require('../errors/envelope');
const { redactText } = require('../utils/redactSecrets');
const { analyze, GraphqlRequestError } = require('./guard');
const { schema, rootValue } = require('./schema');

function hybridBody({ code, message, details = [], correlationId, extensions = {} }) {
  const body = buildErrorBody({ code, message, details, correlationId });
  body.errors = [{ message, extensions: { code, correlationId: correlationId || null, ...extensions } }];
  return body;
}

function readParams(req) {
  if (req.method === 'GET') {
    let variables;
    if (req.query.variables !== undefined) {
      try { variables = JSON.parse(String(req.query.variables)); } catch { throw new GraphqlRequestError('INVALID_JSON', 'The "variables" parameter is not valid JSON.'); }
    }
    return { query: req.query.query, variables, operationName: req.query.operationName };
  }
  const b = req.body;
  if (Array.isArray(b)) throw new GraphqlRequestError('INVALID_REQUEST', 'Batched GraphQL requests are not supported.');
  if (!b || typeof b !== 'object') throw new GraphqlRequestError('INVALID_REQUEST', 'The request body must be a JSON object with a "query" field.');
  return { query: b.query, variables: b.variables, operationName: b.operationName };
}

function checkParamTypes({ variables, operationName }) {
  if (variables !== undefined && variables !== null && (typeof variables !== 'object' || Array.isArray(variables))) {
    throw new GraphqlRequestError('INVALID_REQUEST', '"variables" must be a JSON object.');
  }
  if (operationName !== undefined && operationName !== null && typeof operationName !== 'string') {
    throw new GraphqlRequestError('INVALID_REQUEST', '"operationName" must be a string.');
  }
}

// Maps an error thrown by a resolver to a safe GraphQL error entry (nothing internal leaks).
function formatExecutionError(err, correlationId) {
  const original = err.originalError;
  if (original instanceof ApiError) {
    return {
      message: original.message,
      ...(err.path ? { path: err.path } : {}),
      extensions: { code: original.code, correlationId, ...(original.details && original.details.length ? { details: original.details } : {}) },
    };
  }
  if (!original) {
    // Errors graphql-js raised itself (e.g. variable coercion): safe by construction.
    return { message: err.message, ...(err.path ? { path: err.path } : {}), extensions: { code: 'GRAPHQL_VALIDATION_FAILED', correlationId } };
  }
  logger.error('graphql_resolver_error', { correlationId, cause: redactText(original.message).slice(0, 300) });
  return { message: 'Something went wrong. Please try again.', ...(err.path ? { path: err.path } : {}), extensions: { code: 'INTERNAL_SERVER_ERROR', correlationId } };
}

async function graphqlHandler(req, res, next) {
  const correlationId = req.correlationId;
  const started = Date.now();
  let opInfo = { type: null, name: null };
  try {
    const params = readParams(req);
    checkParamTypes(params);
    const analysis = analyze(params);
    opInfo = analysis.operation;

    if (req.method === 'GET' && analysis.operation.type !== 'query') {
      res.setHeader('Allow', 'POST');
      throw new ApiError(405, 'GRAPHQL_MUTATION_OVER_GET', 'Only queries may be sent with GET. Use POST for mutations.');
    }
    if (analysis.introspection && !env.GRAPHQL_INTROSPECTION) {
      throw new GraphqlRequestError('GRAPHQL_INTROSPECTION_DISABLED', 'Schema introspection is disabled on this server.');
    }

    const rules = env.GRAPHQL_INTROSPECTION ? specifiedRules : [...specifiedRules, NoSchemaIntrospectionCustomRule];
    const problems = validate(schema, analysis.document, rules);
    if (problems.length) {
      const details = problems.slice(0, 10).map((p) => ({ field: (p.path || []).join('.') || '(query)', message: p.message }));
      res.status(400).json({
        ...buildErrorBody({ code: 'GRAPHQL_VALIDATION_FAILED', message: 'The GraphQL document is not valid against the schema.', details, correlationId }),
        errors: problems.slice(0, 10).map((p) => ({ message: p.message, locations: p.locations, extensions: { code: 'GRAPHQL_VALIDATION_FAILED', correlationId } })),
      });
      return;
    }

    // Bounded execution: a resolver that hangs cannot hold the request open.
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), env.GRAPHQL_EXEC_TIMEOUT_MS);
    });
    const exec = Promise.resolve(execute({
      schema,
      document: analysis.document,
      rootValue,
      contextValue: { user: req.user, correlationId, signal: undefined },
      variableValues: params.variables || undefined,
      operationName: params.operationName || undefined,
    }));
    const result = await Promise.race([exec, timeout]).finally(() => clearTimeout(timer));
    exec.catch(() => {});

    if (result.timedOut) {
      res.status(504).json(hybridBody({ code: 'GRAPHQL_EXECUTION_TIMEOUT', message: 'The GraphQL operation did not finish in time.', correlationId }));
      return;
    }
    const body = { data: result.data === undefined ? null : result.data };
    if (result.errors && result.errors.length) body.errors = result.errors.map((e) => formatExecutionError(e, correlationId));
    body.extensions = { correlationId };
    // `data` is absent (null) only when the failure happened before execution started, e.g. variable coercion.
    const status = result.data === undefined ? 400 : 200;
    res.locals.logExtra = { protocol: 'GRAPHQL', graphqlOperation: opInfo.type, graphqlName: opInfo.name, upstreamTimeMs: Date.now() - started };
    res.status(status).json(body);
  } catch (err) {
    next(err);
  }
}

// Router-level error handler: GraphQL-flavoured body for GraphQL routes.
// eslint-disable-next-line no-unused-vars
function graphqlErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const correlationId = req.correlationId;
  let status; let code; let message; let details = []; let extensions = {};
  if (err instanceof GraphqlRequestError) {
    ({ status, code, message } = err); extensions = err.extensions;
  } else if (err instanceof ApiError) {
    status = err.statusCode; code = err.code; message = err.message; details = err.details;
    if (err.headers) Object.entries(err.headers).forEach(([k, v]) => res.setHeader(k, v));
  } else {
    return next(err); // everything else uses the central handler (JSON parse errors, unexpected 500s ...)
  }
  if (status === 429 && !res.getHeader('Retry-After')) res.setHeader('Retry-After', '60');
  logger.warn('graphql_request_rejected', { correlationId, code, status });
  return res.status(status).json(hybridBody({ code, message, details, correlationId, extensions }));
}

module.exports = { graphqlHandler, graphqlErrorHandler };
