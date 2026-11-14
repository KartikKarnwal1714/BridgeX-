const apiKeyService = require('../services/apiKeyService');
const { success } = require('../utils/response');

async function list(req, res, next) {
  try {
    const data = await apiKeyService.listKeys(req.user);
    return success(res, data);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const data = await apiKeyService.createKey(req.body, req.user.id);
    return success(res, data, 'API key created', 201);
  } catch (err) {
    return next(err);
  }
}

async function revoke(req, res, next) {
  try {
    const data = await apiKeyService.revokeKey(req.params.id, req.user);
    return success(res, data, 'API key revoked');
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    await apiKeyService.deleteKey(req.params.id);
    return success(res, null, 'API key deleted');
  } catch (err) {
    return next(err);
  }
}

async function updateGateway(req, res, next) {
  try {
    const data = await apiKeyService.updateGatewaySettings(req.params.id, req.body);
    return success(res, data, 'API key gateway settings updated');
  } catch (err) {
    return next(err);
  }
}

async function patch(req, res, next) {
  try {
    const data = await apiKeyService.patchKey(req.params.id, req.body, req.user);
    return success(res, data, 'API key updated');
  } catch (err) {
    return next(err);
  }
}

// Legacy action-style aliases stay working but announce their replacement.
function deprecated(successor) {
  return (req, res, next) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', `<${successor}>; rel="successor-version"`);
    next();
  };
}

module.exports = { patch, deprecated, list, create, revoke, remove, updateGateway };
