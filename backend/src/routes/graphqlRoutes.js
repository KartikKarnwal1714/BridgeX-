const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { authenticate } = require('../middleware/auth');
const { ApiError } = require('../utils/response');
const { graphqlHandler, graphqlErrorHandler } = require('../graphql/handler');

const router = express.Router();

// JWT authentication, exactly like the REST API. Role checks happen per field in the resolvers,
// using the same role lists as the equivalent REST routes.
router.use(authenticate);

// Per-user limit on top of the global limiter (GraphQL lets one request ask for a lot of work).
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: env.GRAPHQL_RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `gql:${req.user.id}`,
  handler: (req, res, next) => {
    res.setHeader('Retry-After', '60');
    next(new ApiError(429, 'RATE_LIMITED', 'Too many GraphQL requests. Please retry later.'));
  },
}));

router.post('/', graphqlHandler);
router.get('/', graphqlHandler);
router.use(graphqlErrorHandler);

module.exports = router;
