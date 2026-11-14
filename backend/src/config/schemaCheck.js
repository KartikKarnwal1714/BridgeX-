// Verifies that the database has every column BridgeX's current code needs. Phase 5 added columns to
// "integrations" (migrations/006_integration_protocols.sql). A Phase 4 database without them makes every
// integration query fail, so it is detected explicitly and reported with the exact fix.
const REQUIRED = {
  integrations: [
    'config', 'auth_mode', 'auth_header', 'credential_enc', 'timeout_ms',
    'last_verified_at', 'last_verification_status', 'last_verification_error', 'last_verification_ms',
  ],
};
const FIX = 'Run: npm run migrate:phase5   (additive and re-runnable; read migrations/006_integration_protocols.sql first)';

async function missingColumns(pool) {
  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED)) {
    const { rows } = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table],
    );
    const have = new Set(rows.map((r) => r.column_name));
    for (const c of columns) if (!have.has(c)) missing.push(`${table}.${c}`);
  }
  return missing;
}

module.exports = { missingColumns, REQUIRED, FIX };
