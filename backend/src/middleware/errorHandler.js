const { ApiError } = require('../utils/response');
const { buildErrorBody } = require('../errors/envelope');
const { CATALOG } = require('../errors/catalog');
const logger = require('../utils/logger');
const { redactText } = require('../utils/redactSecrets');

// Fixed, safe messages by HTTP status for errors raised by libraries (never the library's own text,
// which can contain SQL, file paths, hostnames or tokens).
const STATUS_DEFAULTS = {
  400: ['INVALID_REQUEST', 'The request could not be processed.'],
  401: ['UNAUTHORIZED', 'Authentication is required or has failed.'],
  403: ['FORBIDDEN', 'You do not have permission to perform this action.'],
  404: ['NOT_FOUND', 'The requested resource was not found.'],
  405: ['METHOD_NOT_ALLOWED', 'Method not allowed for this resource.'],
  406: ['NOT_ACCEPTABLE', 'Supported response types are application/json and application/xml.'],
  409: ['CONFLICT', 'The request conflicts with the current state of the resource.'],
  413: ['PAYLOAD_TOO_LARGE', 'Request body is too large.'],
  414: ['URI_TOO_LONG', 'Request URL is too long.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'The request content type or encoding is not supported.'],
  429: ['RATE_LIMITED', 'Too many requests. Please retry later.'],
};

/**
 * Turns well-known failures (malformed JSON body, bad id format, constraint violations, JWT errors,
 * unavailable data stores, framework-raised HTTP errors) into proper ApiErrors instead of 500s.
 * Anything unrecognised is left alone and becomes a generic 500.
 */
function translateKnownError(err) {
  if (!err) return err;
  if (err.type === 'entity.parse.failed') return new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (err.type === 'entity.too.large') return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') {
    return new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The request content type or encoding is not supported');
  }
  if (err instanceof URIError) return new ApiError(400, 'INVALID_PATH', 'Request path contains invalid percent-encoding');

  // JWT problems that escaped the auth middleware.
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
    return new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }

  // PostgreSQL
  if (err.code === '22P02' || err.code === '22003' || err.code === '22001') return new ApiError(400, 'VALIDATION_ERROR', 'Invalid identifier or value in request');
  if (err.code === '23502' || err.code === '23514') return new ApiError(400, 'VALIDATION_ERROR', 'Invalid identifier or value in request');
  if (err.code === '23505') return new ApiError(409, 'CONFLICT', 'A record with these values already exists');
  if (err.code === '23503') return new ApiError(409, 'CONFLICT', 'The request conflicts with related records');
  // 42703 undefined_column / 42P01 undefined_table: the code is newer than the database schema (a migration was not run).
  // That is an operator problem, not a client error and not a bug in the request, so say so instead of a bare 500.
  if (err.code === '42703' || err.code === '42P01') {
    return new ApiError(503, 'DATABASE_MIGRATION_REQUIRED', 'The database schema is out of date. An administrator must run "npm run migrate:phase5" and restart the API.');
  }
  if (err.code === '57014' || err.code === 'ETIMEDOUT') return new ApiError(503, 'DATABASE_TIMEOUT', 'The database request timed out. Please retry.');
  if (err.code === '53300' || err.code === 'ECONNREFUSED' || err.code === '57P01' || err.code === '57P03') {
    return new ApiError(503, 'DATABASE_UNAVAILABLE', 'A required data service is temporarily unavailable.');
  }

  // MongoDB / Mongoose
  if (/^Mongo(Server)?(Selection|Network|Timeout)?Error$|^MongooseServerSelectionError$|^MongoNetworkError$/.test(err.name || '')) {
    return new ApiError(503, 'LOG_STORE_UNAVAILABLE', 'A required data service is temporarily unavailable.');
  }

  // Framework / http-errors style: a 4xx that the framework itself marked as safe to expose.
  const status = err.status || err.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500 && STATUS_DEFAULTS[status]) {
    const [code, message] = STATUS_DEFAULTS[status];
    return new ApiError(status, code, message);
  }
  return err;
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const mapped = err instanceof ApiError ? err : translateKnownError(err);
  const isApiError = mapped instanceof ApiError;

  const statusCode = isApiError ? mapped.statusCode : 500;
  const code = isApiError ? mapped.code : 'INTERNAL_SERVER_ERROR';
  const message = isApiError ? mapped.message : 'Something went wrong. Please try again.';
  const details = isApiError ? mapped.details : [];

  // Unknown codes would break the "consistent error codes" promise: surface them loudly in logs.
  if (!CATALOG[code]) logger.warn('error_code_not_in_catalog', { code, correlationId: req.correlationId });

  const level = statusCode >= 500 ? 'error' : 'warn';
  logger[level](message, {
    code,
    statusCode,
    correlationId: req.correlationId,
    path: req.path,
    method: req.method,
    category: mapped && mapped.category,
    // The original (unmapped) failure, with credentials removed - never request bodies.
    cause: !isApiError || statusCode >= 500 ? redactText(err && err.message).slice(0, 300) : undefined,
    ...(process.env.NODE_ENV === 'production' ? {} : { stack: redactText(err && err.stack) }),
  });

  if (isApiError && mapped.headers) {
    Object.entries(mapped.headers).forEach(([name, value]) => res.setHeader(name, value));
  }
  if (statusCode === 429 && !res.getHeader('Retry-After')) res.setHeader('Retry-After', '60');
  res.status(statusCode).json(buildErrorBody({ code, message, details, correlationId: req.correlationId }));
}

module.exports = errorHandler;
module.exports.translateKnownError = translateKnownError;
