const integrationService = require('../services/integrationService');
const { success } = require('../utils/response');
const { requestContext } = require('../utils/requestContext');

async function list(req, res, next) {
  try {
    const integrations = await integrationService.listIntegrations();
    return success(res, integrations);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const integration = await integrationService.getIntegration(req.params.id);
    return success(res, integration);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const integration = await integrationService.createIntegration(req.body);
    return success(res, integration, 'Integration created', 201);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const fields = req.method === 'PUT' ? { ...req.body, status: req.body.status || 'Pending' } : req.body;
    const integration = await integrationService.updateIntegration(req.params.id, fields);
    return success(res, integration, 'Integration updated');
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    await integrationService.deleteIntegration(req.params.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

// Records protocol/reliability details on the request log entry written by the request logger.
function logReliability(res, protocol, meta = {}, extra = {}) {
  res.locals.logExtra = {
    protocol,
    attempts: meta.attempts, retries: meta.retries, retryDelayMs: meta.retryDelayMs, timedOut: Boolean(meta.timedOut),
    breakerState: meta.breakerState, circuitOpen: Boolean(meta.circuitOpen),
    upstreamStatus: meta.upstreamStatus === undefined ? null : meta.upstreamStatus, upstreamTimeMs: meta.upstreamMs === undefined ? null : meta.upstreamMs,
    ...extra,
  };
}

// POST /integrations/:id/verifications - creates a verification (a real connection check) and returns it.
async function verify(req, res, next) {
  try {
    const result = await integrationService.verifyIntegration(req.params.id, requestContext(req, res));
    logReliability(res, result.protocol, result.meta, { outcome: result.status === 'Connected' ? 'success' : 'upstream_error', errorCategory: result.error ? result.error.code.toLowerCase() : null });
    const { meta, ...body } = result;
    res.location(`/api/v1/integrations/${req.params.id}`);
    return success(res, body, result.status === 'Connected' ? 'Integration verified' : 'Integration verification failed', 201);
  } catch (err) {
    return next(err);
  }
}

async function operations(req, res, next) {
  try {
    return success(res, await integrationService.listSoapOperations(req.params.id, requestContext(req, res)));
  } catch (err) {
    if (err.meta) logReliability(res, 'SOAP', err.meta);
    return next(err);
  }
}

async function graphql(req, res, next) {
  try {
    const out = await integrationService.invokeGraphql(req.params.id, req.body, requestContext(req, res));
    logReliability(res, 'GRAPHQL', out.meta, { outcome: 'success', graphqlOperation: out.meta.operation.type, graphqlName: out.meta.operation.name });
    res.setHeader('Cache-Control', 'no-store');
    // Upstream GraphQL result passed through unchanged (data and/or errors).
    return res.status(200).json(out.body);
  } catch (err) {
    if (err.meta) logReliability(res, 'GRAPHQL', err.meta, { outcome: err.outcome || 'gateway_error', errorCategory: err.category || null });
    return next(err);
  }
}

async function soap(req, res, next) {
  try {
    const out = await integrationService.invokeSoap(req.params.id, req.body, requestContext(req, res));
    logReliability(res, 'SOAP', {}, { outcome: 'success', upstreamTimeMs: out.durationMs });
    return success(res, out, 'SOAP call completed');
  } catch (err) {
    if (err.meta) logReliability(res, 'SOAP', err.meta, { outcome: err.outcome || 'gateway_error', errorCategory: err.category || null });
    else logReliability(res, 'SOAP', {}, { outcome: err.outcome || 'gateway_error', errorCategory: err.category || null });
    return next(err);
  }
}

module.exports = { list, getOne, create, update, remove, verify, operations, graphql, soap };
