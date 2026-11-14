
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const env = require('./config/env');
const correlationId = require('./middleware/correlationId');
const requestLogger = require('./middleware/requestLogger');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');
const gatewayRouter = require('./gateway/gatewayRouter');
const { ApiError } = require('./utils/response');
const { listRoutes } = require('./utils/routeIntrospection');

const app = express();

app.use(helmet());

// API gateway. Mounted before express.json(), the dashboard request logger and the dashboard
// rate limiter: gateway bodies must stay raw streams, each gateway request is logged exactly once
// by the gateway itself, and gateway clients are limited per API key rather than by this global cap.
// No CORS here — the gateway is for server-to-server calls, not browsers on other origins.
app.use('/gateway', gatewayRouter);

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-None-Match', 'X-Correlation-ID'],
    exposedHeaders: ['ETag', 'X-Correlation-ID', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 600,
  })
);
app.use(correlationId);
app.use(express.json());
app.use(requestLogger);
// Private dashboard/API responses must not be retained by shared caches.
app.use('/api/v1', (req, res, next) => {
  const publicGet = req.method === 'GET' && (/^\/health(?:\/|$)/.test(req.path) || /^\/docs(?:\/|$)/.test(req.path));
  res.setHeader('Cache-Control', publicGet ? 'public, max-age=60, must-revalidate' : 'no-store');
  next();
});
app.set('etag', 'weak');
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && body.success === false) return originalJson(body);
    res.vary('Accept');
    const supported = req.accepts(['json', 'xml']);
    const wantsXml = supported === 'xml';
    if (!supported) {
      return next(new ApiError(406, 'NOT_ACCEPTABLE', 'Supported response types are application/json and application/xml'));
    }
    if (wantsXml) {
      const escape = (value) => Array.from(String(value))
        .filter((char) => {
          const code = char.codePointAt(0);
          return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
        })
        .join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');
      const node = (name, value) => {
        const tag = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) ? name : 'item';
        if (value === null || value === undefined) return `<${tag}/>`;
        if (Array.isArray(value)) return value.map((v) => node('item', v)).join('');
        if (typeof value === 'object') return `<${tag}>${Object.entries(value).map(([k,v]) => node(k,v)).join('')}</${tag}>`;
        return `<${tag}>${escape(value)}</${tag}>`;
      };
      res.type('application/xml; charset=utf-8');
      const xml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>${node('response', body)}`;
      return res.send(xml);
    }
    res.type('application/json');
    return originalJson(body);
  };
  next();
});

// Basic global rate limiting. Route-specific limits (e.g. login) arrive in
// a later phase alongside the full Redis-backed limiter.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) => {
      res.setHeader('Retry-After', '900');
      next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please retry later.'));
    },
  })
);

// Swagger / OpenAPI docs
const openapiDocument = YAML.load(path.join(__dirname, 'docs', 'openapi.yaml'));
app.use('/api-docs', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use('/api/v1', routes);

// Known API paths with an unsupported verb are 405; unrelated paths remain 404.
app.use('/api/v1', (req, res, next) => {
  const definitions = listRoutes(routes);
  const known = definitions.filter((route) => {
    const relative = route.path.replace(/^\/api\/v1/, '');
    const expression = new RegExp(`^${relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '[^/]+')}/?$`);
    return expression.test(req.path);
  });
  if (known.length) {
    const methods = [...new Set(known.map((r) => r.method))];
    if (methods.includes('GET') && !methods.includes('HEAD')) methods.push('HEAD');
    if (!methods.includes('OPTIONS')) methods.push('OPTIONS');
    const allow = methods.join(', ');
    if (!methods.includes(req.method)) {
      res.set('Allow', allow);
      return next(new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for this resource'));
    }
  }
  next();
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
