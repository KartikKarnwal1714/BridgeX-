// The ONE error body shape. Every BridgeX-generated error response - dashboard API, gateway, rate
// limiter, 404/405/406, GraphQL transport errors - is built here.
//
//   { "success": false,
//     "error": { "code": "UPSTREAM_TIMEOUT", "message": "...", "details": [], "correlationId": "..." } }
//
// `details` is always an array (empty when there is nothing to add). Nothing in this file ever receives
// an Error object's message/stack: callers pass already-safe strings.

function buildErrorBody({ code, message, details = [], correlationId = null, requestId }) {
  const body = {
    success: false,
    error: {
      code,
      message,
      details: Array.isArray(details) ? details : [],
      correlationId: correlationId || null,
    },
  };
  // Gateway responses have always carried a top-level requestId; kept for backward compatibility.
  if (requestId) body.requestId = requestId;
  return body;
}

module.exports = { buildErrorBody };
