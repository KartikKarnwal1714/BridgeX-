const { listRoutes } = require('../utils/routeIntrospection');

// Human-written text only. WHICH endpoints exist, and who may call them,
// is read from the real routers (see utils/routeIntrospection.js) so it can
// never drift. If you add a route, add its one-line description here; the
// test suite fails until you do.
const SECTION_NAMES = {
  '/health': 'Health',
  '/auth': 'Authentication',
  '/users': 'Users',
  '/apis': 'APIs & Services',
  '/integrations': 'Integrations',
  '/dashboard': 'Dashboard',
  '/analytics': 'Analytics',
  '/logs': 'Logs',
  '/api-keys': 'API Keys',
  '/system-health': 'System Health',
  '/settings': 'Settings',
  '/docs': 'Documentation',
  '/graphql': 'GraphQL',
};

const DESCRIPTIONS = {
  'GET /api/v1/health': 'Public health summary (Postgres, plus optional Mongo/Redis status)',
  'GET /api/v1/health/live': 'Liveness probe: the process is running (no dependency checks)',
  'GET /api/v1/health/ready': 'Readiness probe: 200 only when PostgreSQL is reachable, otherwise 503',
  'POST /api/v1/auth/register': 'DEPRECATED alias of POST /auth/registrations',
  'POST /api/v1/auth/login': 'DEPRECATED alias of POST /auth/sessions',
  'GET /api/v1/auth/me': 'DEPRECATED alias of GET /auth/sessions/current',
  'GET /api/v1/users': 'List all users',
  'GET /api/v1/users/{id}': 'Get a user by ID',
  'POST /api/v1/users': 'Create a user',
  'PUT /api/v1/users/{id}': 'Update a user',
  'DELETE /api/v1/users/{id}': 'Delete a user (you cannot delete yourself)',
  'GET /api/v1/apis': 'List registered APIs (including gateway route settings; upstream credentials are never returned)',
  'GET /api/v1/apis/{id}': 'Get an API by ID',
  'POST /api/v1/apis': 'Register a new API, optionally with a gateway route (gateway_slug) and upstream settings',
  'PUT /api/v1/apis/{id}': 'Update an API, its gateway route, enable/disable it, or rotate its upstream credential',
  'DELETE /api/v1/apis/{id}': 'Delete an API',
  'GET /api/v1/integrations': 'List integrations',
  'GET /api/v1/integrations/{id}': 'Get an integration by ID',
  'POST /api/v1/integrations': 'Create an integration',
'PATCH /api/v1/integrations/{id}': 'Partially update an integration',
  'PUT /api/v1/integrations/{id}': 'Update an integration',
  'DELETE /api/v1/integrations/{id}': 'Delete an integration',
  'GET /api/v1/dashboard/stats': 'Aggregate KPI stats from the registered-API counters',
  'GET /api/v1/dashboard/traffic': 'Last 7 days of real request traffic (empty if no log data)',
  'GET /api/v1/dashboard/protocol-distribution': 'API protocol breakdown',
  'GET /api/v1/dashboard/top-apis': 'Top registered APIs by request counter',
  'GET /api/v1/dashboard/system-status': 'Quick infrastructure status summary',
  'GET /api/v1/analytics/cards': 'Summary cards for a date range (?from, ?to, ?interval)',
  'GET /api/v1/analytics/traffic': 'Requests over time for a date range (?from, ?to, ?interval=hour|day)',
  'GET /api/v1/analytics/top-endpoints': 'Most-requested paths in a date range',
  'GET /api/v1/analytics/gateway': 'Gateway usage per API, per API key and per outcome for a date range (?from, ?to)',
  'GET /api/v1/logs': 'Search request logs (?page, ?limit, ?q, ?method, ?status, ?source=gateway|dashboard, ?from, ?to)',
  'GET /api/v1/logs/{id}': 'Get one request log entry',
  'GET /api/v1/api-keys': 'List API keys (your own, or all for SUPER_ADMIN)',
  'POST /api/v1/api-keys': 'Create an API key (the full key is shown only in this response)',
  'PATCH /api/v1/api-keys/{id}/revoke': 'DEPRECATED: use PATCH /api-keys/{id} with {"status":"revoked"}',
  'PATCH /api/v1/api-keys/{id}/gateway': 'DEPRECATED: use PATCH /api-keys/{id} (SUPER_ADMIN)',
  'DELETE /api/v1/api-keys/{id}': 'Permanently delete an API key',
  'GET /api/v1/system-health': 'Live per-dependency status, latency and sampled availability',
  'GET /api/v1/system-health/alerts': 'Recent error/warning entries from the request log',
  'GET /api/v1/settings': 'Get platform settings',
  'PUT /api/v1/settings': 'Update platform settings',
  'POST /api/v1/auth/registrations': 'Create a registration (new VIEWER account); replaces POST /auth/register',
  'POST /api/v1/auth/sessions': 'Create a session (log in) and receive a JWT; replaces POST /auth/login',
  'GET /api/v1/auth/sessions/current': 'Get the current session\'s user; replaces GET /auth/me',
  'PATCH /api/v1/api-keys/{id}': 'Revoke a key ({"status":"revoked"}) and/or change its rate limit, expiry and granted APIs (SUPER_ADMIN for the latter)',
  'POST /api/v1/integrations/{id}/verifications': 'Run a real connection check (REST, GraphQL or SOAP/WSDL) and record the result',
  'GET /api/v1/integrations/{id}/operations': 'List the operations discovered from a SOAP integration\'s WSDL',
  'POST /api/v1/integrations/{id}/graphql': 'Forward a GraphQL query/mutation to a GraphQL integration (limits, timeout, retry for queries, circuit breaker)',
  'POST /api/v1/integrations/{id}/soap': 'Call an operation of a SOAP integration (SOAP 1.1/1.2 envelope built from the WSDL)',
  'POST /api/v1/graphql': 'BridgeX GraphQL endpoint: queries and mutations over APIs, integrations, API keys and circuit breakers',
  'GET /api/v1/graphql': 'Run a GraphQL query via GET (mutations are refused)',
  'GET /api/v1/system-health/circuit-breakers': 'State of every outbound circuit breaker (closed/open/half_open) and whether state is shared via Redis',
  'DELETE /api/v1/system-health/circuit-breakers/{key}': 'Reset (close) one circuit breaker',
  'GET /api/v1/analytics/reliability': 'Retries, timeouts and circuit-breaker rejections per protocol (?from, ?to)',
  'GET /api/v1/docs/endpoints': 'This endpoint list, generated from the registered routes',
};

function getEndpoints() {
  // Required lazily: the routes import the docs controller, which imports this file.
  const apiRouter = require('../routes');
  const grouped = {};
  for (const route of listRoutes(apiRouter)) {
    const section = SECTION_NAMES[route.prefix] || route.prefix;
    (grouped[section] ||= []).push({
      method: route.method,
      path: route.path,
      desc: DESCRIPTIONS[`${route.method} ${route.path}`] || 'No description yet',
      auth: route.auth ? 'Bearer JWT' : 'Public',
      roles: route.roles || (route.auth ? 'Any signed-in role' : 'n/a'),
    });
  }
  return grouped;
}

module.exports = { getEndpoints, DESCRIPTIONS };
