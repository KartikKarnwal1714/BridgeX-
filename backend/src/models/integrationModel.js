const { pool } = require('../config/database');

// Explicit column list: the encrypted credential is NEVER selected for dashboard responses; only a
// boolean saying whether one is stored is exposed.
const PUBLIC_COLUMNS = `
  id, name, type, protocol, endpoint, status, last_sync, created_at, updated_at,
  config, auth_mode, auth_header, (credential_enc IS NOT NULL) AS has_credential, timeout_ms,
  last_verified_at, last_verification_status, last_verification_error, last_verification_ms
`;

// Columns update() may write. Anything else is ignored, so column names can never come from request data.
const WRITABLE = new Set(['name', 'type', 'protocol', 'endpoint', 'status', 'config', 'auth_mode', 'auth_header', 'credential_enc', 'timeout_ms']);

async function findAll() {
  const { rows } = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM integrations ORDER BY created_at DESC`);
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM integrations WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Internal: includes the encrypted credential. Used only to call the upstream.
async function findByIdWithSecret(id) {
  const { rows } = await pool.query(`SELECT * FROM integrations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function create(fields) {
  const { status = 'Pending' } = fields;
  const data = { ...fields, status };
  const keys = Object.keys(data).filter((k) => WRITABLE.has(k) && data[k] !== undefined);
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO integrations (${keys.join(', ')}) VALUES (${params}) RETURNING ${PUBLIC_COLUMNS}`,
    keys.map((k) => data[k])
  );
  return rows[0];
}

async function update(id, fields) {
  const keys = Object.keys(fields).filter((k) => WRITABLE.has(k));
  if (keys.length === 0) return findById(id);

  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  const values = keys.map((key) => fields[key]);

  const { rows } = await pool.query(
    `UPDATE integrations SET ${setClause}, last_sync = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, ...values]
  );
  return rows[0] || null;
}

// Stores the outcome of a real connection check. 'Connected' is only ever written here.
async function recordVerification(id, { status, error, ms }) {
  const { rows } = await pool.query(
    `UPDATE integrations SET status = $2, last_verified_at = NOW(), last_sync = NOW(),
            last_verification_status = $2, last_verification_error = $3, last_verification_ms = $4
     WHERE id = $1
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, status, error ? String(error).slice(0, 300) : null, ms]
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rowCount } = await pool.query(`DELETE FROM integrations WHERE id = $1`, [id]);
  return rowCount > 0;
}

module.exports = { findAll, findById, findByIdWithSecret, create, update, recordVerification, remove };
