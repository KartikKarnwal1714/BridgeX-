// Circuit breaker for outbound upstreams: CLOSED -> OPEN -> HALF_OPEN -> CLOSED.
//
//   CLOSED     requests flow. `failureThreshold` CONSECUTIVE infrastructure failures open the circuit
//              (a success resets the streak).
//   OPEN       requests are rejected immediately (no network I/O, no retry storm) for `openMs`.
//   HALF_OPEN  after `openMs` a limited number (`halfOpenMaxProbes`) of probe requests are let through
//              concurrently. `successThreshold` probe successes close the circuit; ANY probe failure
//              re-opens it for another full `openMs`.
//
// State lives in a store:
//   * RedisStore  - shared by every BridgeX instance. All transitions are single Lua scripts that read
//                   Redis' own clock, so concurrent requests on different instances cannot double-count,
//                   over-admit probes, or disagree about time.
//   * MemoryStore - per process. Used when BREAKER_STORE=memory, and as the automatic fallback while
//                   Redis is unreachable. In that degraded mode each instance protects itself independently
//                   (state is NOT shared) - this is logged and reported by the visibility endpoint.
// What counts as a failure is decided by the caller (outbound client): timeouts, connection failures,
// TLS/protocol errors and HTTP 500/502/503/504. HTTP 4xx (including 429) never do.
const { EventEmitter } = require('events');
const env = require('../config/env');
const logger = require('../utils/logger');
const { redisClient, isRedisConnected } = require('../config/redis');

const KEY_PREFIX = 'bx:cb:';
const MAX_MEMORY_KEYS = 5000;

function defaults() {
  return {
    failureThreshold: env.BREAKER_FAILURE_THRESHOLD,
    openMs: env.BREAKER_OPEN_MS,
    halfOpenMaxProbes: env.BREAKER_HALF_OPEN_MAX_PROBES,
    successThreshold: env.BREAKER_SUCCESS_THRESHOLD,
  };
}
function resolveConfig(o = {}) {
  const d = defaults();
  const pick = (v, f) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : f);
  return {
    failureThreshold: pick(o.failureThreshold, d.failureThreshold),
    openMs: pick(o.openMs, d.openMs),
    halfOpenMaxProbes: pick(o.halfOpenMaxProbes, d.halfOpenMaxProbes),
    successThreshold: pick(o.successThreshold, d.successThreshold),
  };
}

// ---------------------------------------------------------------------------------------------------
// Memory store (also the executable specification the Redis scripts mirror)
// ---------------------------------------------------------------------------------------------------
class MemoryStore {
  constructor({ now = () => Date.now() } = {}) {
    this.name = 'memory';
    this.now = now;
    this.map = new Map();
  }

  _get(key) {
    let e = this.map.get(key);
    if (!e) {
      if (this.map.size >= MAX_MEMORY_KEYS) this._evict();
      e = { state: 'closed', failures: 0, successes: 0, probes: 0, openedAt: 0, probeAt: 0, opens: 0, lastFailureAt: 0, lastError: '' };
      this.map.set(key, e);
    }
    return e;
  }

  _evict() {
    for (const [k, e] of this.map) {
      if (e.state === 'closed' && e.failures === 0) { this.map.delete(k); if (this.map.size < MAX_MEMORY_KEYS * 0.9) return; }
    }
    while (this.map.size >= MAX_MEMORY_KEYS) this.map.delete(this.map.keys().next().value);
  }

  async acquire(key, cfg) {
    const e = this._get(key);
    const now = this.now();
    if (e.state === 'closed') return { allowed: true, state: 'closed', probe: false, retryAfterMs: 0, transition: null };
    if (e.state === 'open') {
      const elapsed = now - e.openedAt;
      if (elapsed >= cfg.openMs) {
        e.state = 'half_open'; e.probes = 1; e.successes = 0; e.probeAt = now;
        return { allowed: true, state: 'half_open', probe: true, retryAfterMs: 0, transition: 'half_open' };
      }
      return { allowed: false, state: 'open', probe: false, retryAfterMs: cfg.openMs - elapsed, transition: null };
    }
    // half_open: forget probes older than openMs (a crashed instance never reports back)
    if (e.probes > 0 && now - e.probeAt >= cfg.openMs) e.probes = 0;
    if (e.probes < cfg.halfOpenMaxProbes) {
      e.probes += 1; e.probeAt = now;
      return { allowed: true, state: 'half_open', probe: true, retryAfterMs: 0, transition: null };
    }
    return { allowed: false, state: 'half_open', probe: false, retryAfterMs: 1000, transition: null };
  }

  async record(key, cfg, { ok, probe, cause = '' }) {
    const e = this._get(key);
    const now = this.now();
    let transition = null;
    if (e.state === 'closed') {
      if (ok) e.failures = 0;
      else {
        e.failures += 1; e.lastFailureAt = now; e.lastError = cause;
        if (e.failures >= cfg.failureThreshold) { e.state = 'open'; e.openedAt = now; e.probes = 0; e.successes = 0; e.opens += 1; transition = 'open'; }
      }
    } else if (e.state === 'half_open' && probe) {
      if (e.probes > 0) e.probes -= 1;
      if (ok) {
        e.successes += 1;
        if (e.successes >= cfg.successThreshold) { e.state = 'closed'; e.failures = 0; e.successes = 0; e.probes = 0; transition = 'closed'; }
      } else {
        e.state = 'open'; e.openedAt = now; e.probes = 0; e.successes = 0; e.opens += 1; e.lastFailureAt = now; e.lastError = cause; transition = 'open';
      }
    }
    return { transition, state: e.state };
  }

  async release(key) {
    const e = this.map.get(key);
    if (e && e.state === 'half_open' && e.probes > 0) e.probes -= 1;
  }

  async snapshot(key) {
    const e = this.map.get(key);
    return e ? this._view(key, e) : null;
  }

  async list() {
    return [...this.map.entries()].map(([k, e]) => this._view(k, e));
  }

  async reset(key) { return this.map.delete(key); }
  clear() { this.map.clear(); }

  _view(key, e) {
    return {
      key, state: e.state, consecutiveFailures: e.failures, probesInFlight: e.probes, halfOpenSuccesses: e.successes,
      openedAt: e.openedAt ? new Date(e.openedAt).toISOString() : null,
      lastFailureAt: e.lastFailureAt ? new Date(e.lastFailureAt).toISOString() : null,
      lastError: e.lastError || null, timesOpened: e.opens, store: 'memory',
    };
  }
}

// ---------------------------------------------------------------------------------------------------
// Redis store: each operation is ONE atomic Lua script using Redis TIME.
// ---------------------------------------------------------------------------------------------------
const LUA_NOW = `local t = redis.call('TIME'); local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)`;

const ACQUIRE = `${LUA_NOW}
local openMs = tonumber(ARGV[1]); local maxProbes = tonumber(ARGV[2])
local st = redis.call('HGET', KEYS[1], 'state'); if not st then st = 'closed' end
if st == 'closed' then return {1, 'closed', 0, 0, ''} end
if st == 'open' then
  local openedAt = tonumber(redis.call('HGET', KEYS[1], 'openedAt') or '0')
  local elapsed = now - openedAt
  if elapsed >= openMs then
    redis.call('HSET', KEYS[1], 'state', 'half_open', 'probes', 1, 'successes', 0, 'probeAt', now)
    redis.call('PEXPIRE', KEYS[1], 86400000)
    return {1, 'half_open', 0, 1, 'half_open'}
  end
  return {0, 'open', openMs - elapsed, 0, ''}
end
local probes = tonumber(redis.call('HGET', KEYS[1], 'probes') or '0')
local probeAt = tonumber(redis.call('HGET', KEYS[1], 'probeAt') or '0')
if probes > 0 and now - probeAt >= openMs then probes = 0 end
if probes < maxProbes then
  redis.call('HSET', KEYS[1], 'probes', probes + 1, 'probeAt', now)
  return {1, 'half_open', 0, 1, ''}
end
return {0, 'half_open', 1000, 0, ''}`;

const RECORD = `${LUA_NOW}
local ok = ARGV[1] == '1'; local probe = ARGV[2] == '1'
local threshold = tonumber(ARGV[3]); local successThreshold = tonumber(ARGV[4]); local cause = ARGV[5]
local st = redis.call('HGET', KEYS[1], 'state'); if not st then st = 'closed' end
local transition = ''
if st == 'closed' then
  if ok then
    if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('HSET', KEYS[1], 'failures', 0) end
  else
    redis.call('HSETNX', KEYS[1], 'state', 'closed')
    local f = redis.call('HINCRBY', KEYS[1], 'failures', 1)
    redis.call('HSET', KEYS[1], 'lastFailureAt', now, 'lastError', cause)
    if f >= threshold then
      redis.call('HSET', KEYS[1], 'state', 'open', 'openedAt', now, 'probes', 0, 'successes', 0)
      redis.call('HINCRBY', KEYS[1], 'opens', 1)
      st = 'open'; transition = 'open'
    end
  end
elseif st == 'half_open' and probe then
  local p = tonumber(redis.call('HGET', KEYS[1], 'probes') or '0')
  if p > 0 then redis.call('HSET', KEYS[1], 'probes', p - 1) end
  if ok then
    local s = redis.call('HINCRBY', KEYS[1], 'successes', 1)
    if s >= successThreshold then
      redis.call('HSET', KEYS[1], 'state', 'closed', 'failures', 0, 'successes', 0, 'probes', 0)
      st = 'closed'; transition = 'closed'
    end
  else
    redis.call('HSET', KEYS[1], 'state', 'open', 'openedAt', now, 'probes', 0, 'successes', 0, 'lastFailureAt', now, 'lastError', cause)
    redis.call('HINCRBY', KEYS[1], 'opens', 1)
    st = 'open'; transition = 'open'
  end
end
redis.call('PEXPIRE', KEYS[1], 86400000)
return {transition, st}`;

const RELEASE = `local st = redis.call('HGET', KEYS[1], 'state')
if st == 'half_open' then
  local p = tonumber(redis.call('HGET', KEYS[1], 'probes') or '0')
  if p > 0 then redis.call('HSET', KEYS[1], 'probes', p - 1) end
end
return 1`;

class RedisStore {
  constructor(client = redisClient) {
    this.name = 'redis';
    this.client = client;
  }

  async acquire(key, cfg) {
    const r = await this.client.eval(ACQUIRE, { keys: [KEY_PREFIX + key], arguments: [String(cfg.openMs), String(cfg.halfOpenMaxProbes)] });
    return { allowed: Number(r[0]) === 1, state: String(r[1]), retryAfterMs: Number(r[2]), probe: Number(r[3]) === 1, transition: r[4] ? String(r[4]) : null };
  }

  async record(key, cfg, { ok, probe, cause = '' }) {
    const r = await this.client.eval(RECORD, {
      keys: [KEY_PREFIX + key],
      arguments: [ok ? '1' : '0', probe ? '1' : '0', String(cfg.failureThreshold), String(cfg.successThreshold), String(cause).slice(0, 64)],
    });
    return { transition: r[0] ? String(r[0]) : null, state: String(r[1]) };
  }

  async release(key) {
    await this.client.eval(RELEASE, { keys: [KEY_PREFIX + key], arguments: [] });
  }

  _view(key, h) {
    if (!h || !h.state) return null;
    const ts = (v) => (Number(v) ? new Date(Number(v)).toISOString() : null);
    return {
      key, state: h.state, consecutiveFailures: Number(h.failures || 0), probesInFlight: Number(h.probes || 0),
      halfOpenSuccesses: Number(h.successes || 0), openedAt: ts(h.openedAt), lastFailureAt: ts(h.lastFailureAt),
      lastError: h.lastError || null, timesOpened: Number(h.opens || 0), store: 'redis',
    };
  }

  async snapshot(key) {
    return this._view(key, await this.client.hGetAll(KEY_PREFIX + key));
  }

  async list() {
    const out = [];
    let cursor = '0';
    let guard = 0;
    do {
      const res = await this.client.scan(cursor, { MATCH: `${KEY_PREFIX}*`, COUNT: 100 });
      cursor = String(res.cursor);
      for (const k of res.keys) {
        const v = this._view(k.slice(KEY_PREFIX.length), await this.client.hGetAll(k));
        if (v) out.push(v);
      }
      guard += 1;
    } while (cursor !== '0' && guard < 50 && out.length < 500);
    return out;
  }

  async reset(key) { return (await this.client.del(KEY_PREFIX + key)) > 0; }
}

// ---------------------------------------------------------------------------------------------------
// Breaker facade
// ---------------------------------------------------------------------------------------------------
class CircuitBreaker extends EventEmitter {
  constructor({ preferredStore = null, fallbackStore = new MemoryStore(), isPreferredUp = () => true, storeTimeoutMs = 250 } = {}) {
    super();
    this.storeTimeoutMs = storeTimeoutMs;
    this.preferred = preferredStore;
    this.fallback = fallbackStore;
    this.isPreferredUp = isPreferredUp;
    this.lastDegradedLog = 0;
    this.rejected = new Map(); // key -> count since process start (operational counter)
  }

  _degraded(err) {
    const now = Date.now();
    if (now - this.lastDegradedLog > 30000) {
      this.lastDegradedLog = now;
      logger.warn('circuit_breaker_store_unavailable', { using: 'memory', error: err && err.message });
    }
  }

  async _run(fn) {
    if (this.preferred && this.isPreferredUp()) {
      let timer;
      try {
        // A slow Redis must never stall an outbound call: bounded wait, then degrade to local memory.
        const value = await Promise.race([
          fn(this.preferred),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('breaker store timed out')), this.storeTimeoutMs); }),
        ]);
        return { store: this.preferred, value };
      } catch (err) {
        this._degraded(err);
      } finally {
        clearTimeout(timer);
      }
    }
    return { store: this.fallback, value: await fn(this.fallback) };
  }

  _emit(key, from, to, store, extra = {}) {
    logger.warn('circuit_breaker_transition', { breakerKey: key, from, to, store: store.name, ...extra });
    this.emit('transition', { key, from, to, store: store.name, ...extra });
  }

  /**
   * Ask permission to call `key`. Always resolves (store failures degrade to memory).
   * The returned lease MUST be settled exactly once with success(), failure(cause) or cancel().
   */
  async acquire(key, config) {
    const cfg = resolveConfig(config);
    const { store, value: r } = await this._run((s) => s.acquire(key, cfg));
    if (r.transition) this._emit(key, 'open', r.transition, store);
    if (!r.allowed) {
      this.rejected.set(key, (this.rejected.get(key) || 0) + 1);
      return { allowed: false, state: r.state, retryAfterMs: r.retryAfterMs, store: store.name };
    }
    let settled = false;
    const settle = async (fn) => {
      if (settled) return;
      settled = true;
      try { await fn(); } catch (err) { this._degraded(err); }
    };
    return {
      allowed: true, state: r.state, probe: r.probe, retryAfterMs: 0, store: store.name,
      success: () => settle(async () => {
        const out = await store.record(key, cfg, { ok: true, probe: r.probe });
        if (out.transition) this._emit(key, r.probe ? 'half_open' : 'closed', out.transition, store);
      }),
      failure: (cause) => settle(async () => {
        const out = await store.record(key, cfg, { ok: false, probe: r.probe, cause });
        if (out.transition) this._emit(key, r.probe ? 'half_open' : 'closed', out.transition, store, { cause });
      }),
      cancel: () => settle(async () => { if (r.probe) await store.release(key); }),
    };
  }

  async snapshot(key) {
    const { value } = await this._run((s) => s.snapshot(key));
    return value || { key, state: 'closed', consecutiveFailures: 0, probesInFlight: 0, halfOpenSuccesses: 0, openedAt: null, lastFailureAt: null, lastError: null, timesOpened: 0, store: this.preferred && this.isPreferredUp() ? this.preferred.name : 'memory' };
  }

  async list() {
    const merged = new Map();
    // Local fallback entries first (they exist only if Redis was unavailable at some point), then shared state.
    for (const v of await this.fallback.list()) merged.set(v.key, v);
    if (this.preferred && this.isPreferredUp()) {
      try { for (const v of await this.preferred.list()) merged.set(v.key, v); } catch (err) { this._degraded(err); }
    }
    return [...merged.values()].map((v) => ({ ...v, rejectedSinceStart: this.rejected.get(v.key) || 0 }));
  }

  async reset(key) {
    let removed = await this.fallback.reset(key);
    if (this.preferred && this.isPreferredUp()) {
      try { removed = (await this.preferred.reset(key)) || removed; } catch (err) { this._degraded(err); }
    }
    this.emit('reset', { key });
    return removed;
  }

  mode() {
    if (!this.preferred) return 'memory';
    return this.isPreferredUp() ? 'redis' : 'memory-fallback';
  }
}

const sharedBreaker = new CircuitBreaker({
  preferredStore: env.BREAKER_STORE === 'redis' ? new RedisStore() : null,
  isPreferredUp: isRedisConnected,
});

module.exports = { CircuitBreaker, MemoryStore, RedisStore, breaker: sharedBreaker, resolveConfig };
