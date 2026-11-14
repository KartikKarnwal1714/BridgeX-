const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectPostgres, pool } = require('./config/database');
const { missingColumns, FIX } = require('./config/schemaCheck');
const { connectMongo } = require('./config/mongo');
const { connectRedis } = require('./config/redis');

async function start() {
  // Postgres is required — the API cannot function without it.
  await connectPostgres();

  // A Phase 4 database that skipped migration 006 would turn every integration request into an error.
  // Say so loudly at startup (the integration routes then answer 503 DATABASE_MIGRATION_REQUIRED).
  const missing = await missingColumns(pool).catch(() => []);
  if (missing.length) {
    logger.error('DATABASE SCHEMA OUT OF DATE: Phase 5 migration not applied', { missing, fix: FIX });
  }

  // Mongo and Redis degrade gracefully (see their config modules) so a
  // missing log store or cache never takes the whole API down.
  await connectMongo();
  await connectRedis();

  app.listen(env.PORT, () => {
    logger.info(`BridgeX API listening on port ${env.PORT}`, {
      env: env.NODE_ENV,
      docs: `http://localhost:${env.PORT}/api-docs`,
    });
  });
}

start().catch((err) => {
  logger.error('Failed to start BridgeX API', { error: err.message });
  process.exit(1);
});
