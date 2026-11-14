const systemHealthService = require('../services/systemHealthService');
const { success, ApiError } = require('../utils/response');
const { breaker } = require('../outbound/circuitBreaker');

async function status(req, res, next) {
  try {
    const data = await systemHealthService.getSystemHealth();
    return success(res, data);
  } catch (err) {
    return next(err);
  }
}

async function alerts(req, res, next) {
  try {
    const data = await systemHealthService.getRecentAlerts();
    return success(res, data);
  } catch (err) {
    return next(err);
  }
}

// Live state of every outbound circuit breaker (per upstream), including whether the state is shared
// through Redis or only local to this process.
async function circuitBreakers(req, res, next) {
  try {
    const items = await breaker.list();
    items.sort((a, b) => a.key.localeCompare(b.key));
    return success(res, { mode: breaker.mode(), sharedAcrossInstances: breaker.mode() === 'redis', circuits: items });
  } catch (err) {
    return next(err);
  }
}

// Deleting a circuit's state closes it (a manual reset), e.g. after the upstream owner confirms a fix.
async function resetCircuitBreaker(req, res, next) {
  try {
    const removed = await breaker.reset(req.params.key);
    if (!removed) throw new ApiError(404, 'NOT_FOUND', 'Circuit breaker not found');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { status, alerts, circuitBreakers, resetCircuitBreaker };
