const { buildErrorBody } = require('../errors/envelope');

function success(res, data, message = 'Request successful', statusCode = 200, meta) {
  const body = { success: true, data, message };
  // Optional extra info (pagination, query range, data source). Omitted when
  // not given so existing responses keep exactly the same shape.
  if (meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
}

function error(res, statusCode, code, message, details = [], correlationId = null) {
  return res.status(statusCode).json(buildErrorBody({ code, message, details, correlationId: correlationId || (res.req && res.req.correlationId) }));
}

class ApiError extends Error {
  constructor(statusCode, code, message, details = []) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Optional extras used by the unified error handler (never serialised into the body).
    this.headers = undefined;
  }
}

module.exports = { success, error, ApiError };
