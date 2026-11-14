const { randomUUID } = require('crypto');

function correlationId(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  const id = typeof incoming === 'string' && incoming.length <= 128 && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming)
    ? incoming
    : randomUUID();

  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  next();
}

module.exports = correlationId;
