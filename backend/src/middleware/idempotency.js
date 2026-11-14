const { createHash } = require('crypto');
const { pool } = require('../config/database');
const { ApiError } = require('../utils/response');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

// Apply only to authenticated creation routes. A reservation is inserted before
// calling the route, so concurrent requests cannot both create the resource.
function idempotency(operation) {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next(); // Existing callers retain the original POST behavior.
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(key)) {
      return next(new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 1 to 128 safe ASCII characters'));
    }
    const ownerId = Number(req.user && req.user.id);
    if (!Number.isInteger(ownerId) || ownerId < 1) return next(new ApiError(401, 'UNAUTHORIZED', 'Authenticated owner is required'));
    const fingerprint = createHash('sha256').update(JSON.stringify(canonicalize({ body: req.body ?? null, accept: req.get('Accept') || '' }))).digest('hex');
    try {
      // Expired records are purged lazily by requests that use idempotency, so
      // the table needs no always-on worker and never blocks unrelated traffic.
      await pool.query('DELETE FROM idempotency_records WHERE expires_at < NOW()');
      const inserted = await pool.query(
        `INSERT INTO idempotency_records (owner_id, operation, idempotency_key, request_fingerprint)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, operation, idempotency_key) DO UPDATE SET
           request_fingerprint=EXCLUDED.request_fingerprint, response_status=NULL,
           response_headers='{}'::jsonb, response_body=NULL, created_at=NOW(), expires_at=NOW()+INTERVAL '24 hours'
         WHERE idempotency_records.expires_at <= NOW()
         RETURNING id`,
        [ownerId, operation, key, fingerprint]
      );
      if (!inserted.rowCount) {
        const { rows } = await pool.query(
          `SELECT request_fingerprint, response_status, response_headers, response_body
           FROM idempotency_records WHERE owner_id=$1 AND operation=$2 AND idempotency_key=$3 AND expires_at > NOW()`,
          [ownerId, operation, key]
        );
        const record = rows[0];
        if (!record) return next(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this key is still being processed'));
        if (record.request_fingerprint !== fingerprint) return next(new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request'));
        if (record.response_status == null) return next(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this key is still being processed'));
        for (const [name, value] of Object.entries(record.response_headers || {})) res.set(name, value);
        res.set('Idempotency-Replayed', 'true');
        return res.status(record.response_status).json(record.response_body);
      }

      const originalJson = res.json.bind(res);
      const originalEnd = res.end.bind(res);
      let pendingResponse = null;
      let ended = false;
      res.end = (...args) => {
        if (pendingResponse && !ended) {
          ended = true;
          const { status, body } = pendingResponse;
          const safeHeaders = { 'content-type': res.getHeader('Content-Type') || 'application/json; charset=utf-8' };
          const location = res.getHeader('Location');
          if (location) safeHeaders.location = location;
          pool.query(
            `UPDATE idempotency_records SET response_status=$1, response_headers=$2::jsonb, response_body=$3::jsonb
             WHERE id=$4`,
            [status, JSON.stringify(safeHeaders), JSON.stringify(body), inserted.rows[0].id]
          ).catch(() => {}).finally(() => originalEnd(...args));
          return res;
        }
        return originalEnd(...args);
      };
      res.json = (body) => {
        pendingResponse = { status: res.statusCode, body };
        return originalJson(body);
      };
      res.set('Idempotency-Replayed', 'false');
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = idempotency;
