// Fails fast, with the fix, when the test database has not had the Phase 5 migration applied,
// instead of producing dozens of unrelated-looking 500s. It only READS the schema; it never changes the database.
module.exports = async () => {
  const env = require('../src/config/env');
  const { Pool } = require('pg');
  const { missingColumns, FIX } = require('../src/config/schemaCheck');
  const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    const missing = await missingColumns(pool);
    if (missing.length) {
      throw new Error(
        `\n\nThe database used by the tests is missing Phase 5 columns:\n  ${missing.join('\n  ')}\n${FIX}\n` +
        'Point DATABASE_URL / TEST_DATABASE_URL at a TEST database and apply the migrations to it first.\n',
      );
    }
  } finally {
    await pool.end().catch(() => {});
  }
};
