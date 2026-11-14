// Bounded discard of an unread request body.
//
// Why: when the gateway rejects an upload early (413) it has not read the body. Closing the socket while the
// client is still sending makes the OS answer with a TCP reset, which can destroy the 413 response before the
// client reads it (client sees ECONNRESET/EPIPE). body-parser does the same "read off the entire request"
// before it answers on the dashboard routes. This does it for the gateway - but strictly bounded:
//   * bytes are counted and thrown away, never buffered,
//   * at most `maxBytes` are consumed and at most `timeoutMs` is spent (slow-loris safe),
//   * a client disconnect or stream error ends it immediately.
// Resolves (never rejects) with: 'complete' | 'drained' | 'cap' | 'timeout' | 'closed' | 'error'.
// Anything other than 'complete'/'drained' means the caller should close the connection after responding.
function drainRequest(req, { maxBytes, timeoutMs }) {
  return new Promise((resolve) => {
    if (req.complete && (req.readableEnded || req.readableLength === 0)) return resolve('complete');
    if (req.destroyed || (req.socket && req.socket.destroyed)) return resolve('closed');

    let total = 0;
    let settled = false;
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    if (timer.unref) timer.unref();

    const onData = (chunk) => {
      total += chunk.length;
      if (total > maxBytes) finish('cap');
    };
    const onEnd = () => finish('drained');
    const onClose = () => finish('closed');
    const onError = () => finish('error');

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('close', onClose);
      req.off('error', onError);
      req.on('error', () => {}); // a late stream error must never become an unhandled 'error' event
      resolve(result);
    }

    req.on('data', onData); // attaching a 'data' listener also starts the flow; chunks are dropped, not stored
    req.once('end', onEnd);
    req.once('close', onClose);
    req.once('error', onError);
    req.resume();
  });
}

module.exports = { drainRequest };
