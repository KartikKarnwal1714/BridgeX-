const logService = require('../services/logService');
const { success } = require('../utils/response');

async function list(req, res, next) {
  try {
    const { items, meta } = await logService.listLogs(req.query);
    if (meta.nextCursor) {
      const params = new URLSearchParams(req.query);
      params.set('cursor', meta.nextCursor);
      meta.next = `${req.baseUrl}?${params.toString()}`;
    } else meta.next = null;
    return success(res, items, 'Request successful', 200, meta);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const log = await logService.getLog(req.params.id);
    return success(res, log);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getOne };
