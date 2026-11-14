// Per-request context handed to outbound work: a correlation id plus an AbortSignal that fires when the
// client disconnects before the response is finished, so upstream calls (and retries) stop immediately.
function requestContext(req, res) {
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  return { signal: ac.signal, correlationId: req.correlationId };
}

module.exports = { requestContext };
