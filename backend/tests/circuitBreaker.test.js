// Circuit breaker state machine. The SAME behavioural suite runs against the in-memory store and a REAL
// Redis store (skipped, and reported as skipped, when no Redis is reachable).
const { spawnSync } = require('child_process');
const { createClient } = require('redis');
const { CircuitBreaker, MemoryStore, RedisStore } = require('../src/outbound/circuitBreaker');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const { hostname, port } = new URL(redisUrl);
const redisUp = spawnSync(process.execPath, ['-e',
  `const s=require('net').connect(${Number(port) || 6379},'${hostname}');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));`], { timeout: 3000 }).status === 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = () => `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CFG = { failureThreshold: 3, openMs: 200, halfOpenMaxProbes: 2, successThreshold: 2 };

function suite(label, makeBreaker, enabled = true) {
  (enabled ? describe : describe.skip)(`circuit breaker (${label})`, () => {
    let breaker; let cleanup;
    beforeAll(async () => { ({ breaker, cleanup } = await makeBreaker()); });
    afterAll(async () => { if (cleanup) await cleanup(); });

    const fail = async (key, n = 1, cfg = CFG) => { for (let i = 0; i < n; i += 1) { const l = await breaker.acquire(key, cfg); expect(l.allowed).toBe(true); await l.failure('test'); } };

    it('starts CLOSED and lets requests through', async () => {
      const l = await breaker.acquire(uniq(), CFG);
      expect(l).toMatchObject({ allowed: true, state: 'closed' });
      await l.success();
    });

    it('CLOSED -> OPEN after N consecutive failures; a success in between resets the streak', async () => {
      const key = uniq();
      const events = []; breaker.on('transition', (e) => { if (e.key === key) events.push(e.to); });
      await fail(key, 2);
      const ok = await breaker.acquire(key, CFG); await ok.success(); // streak reset
      await fail(key, 2);
      expect((await breaker.snapshot(key)).state).toBe('closed');
      await fail(key, 1);
      expect((await breaker.snapshot(key)).state).toBe('open');
      expect(events).toEqual(['open']);
    });

    it('rejects requests quickly while OPEN, with a Retry-After hint', async () => {
      const key = uniq();
      await fail(key, 3);
      const l = await breaker.acquire(key, CFG);
      expect(l.allowed).toBe(false);
      expect(l.state).toBe('open');
      expect(l.retryAfterMs).toBeGreaterThan(0);
      expect(l.retryAfterMs).toBeLessThanOrEqual(CFG.openMs);
    });

    it('OPEN -> HALF_OPEN after openMs, then CLOSED after successThreshold probe successes', async () => {
      const key = uniq();
      const events = []; breaker.on('transition', (e) => { if (e.key === key) events.push(e.to); });
      await fail(key, 3);
      await sleep(CFG.openMs + 60);
      const p1 = await breaker.acquire(key, CFG);
      expect(p1).toMatchObject({ allowed: true, state: 'half_open', probe: true });
      await p1.success();
      expect((await breaker.snapshot(key)).state).toBe('half_open'); // needs 2 successes
      const p2 = await breaker.acquire(key, CFG);
      expect(p2.probe).toBe(true);
      await p2.success();
      expect((await breaker.snapshot(key)).state).toBe('closed');
      expect(events).toEqual(['open', 'half_open', 'closed']);
      expect((await breaker.acquire(key, CFG)).allowed).toBe(true);
    });

    it('a failed probe sends the circuit straight back to OPEN for a full open period', async () => {
      const key = uniq();
      await fail(key, 3);
      await sleep(CFG.openMs + 60);
      const p = await breaker.acquire(key, CFG);
      expect(p.state).toBe('half_open');
      await p.failure('probe_failed');
      expect((await breaker.snapshot(key)).state).toBe('open');
      const rejected = await breaker.acquire(key, CFG);
      expect(rejected.allowed).toBe(false);
      expect(rejected.retryAfterMs).toBeGreaterThan(CFG.openMs - 100);
    });

    it('limits concurrent HALF_OPEN probes', async () => {
      const key = uniq();
      await fail(key, 3);
      await sleep(CFG.openMs + 60);
      const leases = await Promise.all(Array.from({ length: 6 }, () => breaker.acquire(key, CFG)));
      expect(leases.filter((l) => l.allowed).length).toBe(CFG.halfOpenMaxProbes);
      expect(leases.filter((l) => !l.allowed).length).toBe(4);
      await Promise.all(leases.filter((l) => l.allowed).map((l) => l.cancel()));
    });

    it('releases a probe slot when the request is cancelled without a verdict', async () => {
      const key = uniq();
      const cfg = { ...CFG, halfOpenMaxProbes: 1 };
      await fail(key, 3, cfg);
      await sleep(cfg.openMs + 60);
      const p = await breaker.acquire(key, cfg);
      expect(p.allowed).toBe(true);
      expect((await breaker.acquire(key, cfg)).allowed).toBe(false);
      await p.cancel();
      expect((await breaker.acquire(key, cfg)).allowed).toBe(true);
    });

    it('handles concurrent failures: opens exactly once and counts each failure once', async () => {
      const key = uniq();
      const events = []; breaker.on('transition', (e) => { if (e.key === key) events.push(e.to); });
      const leases = await Promise.all(Array.from({ length: 20 }, () => breaker.acquire(key, CFG)));
      await Promise.all(leases.map((l) => l.failure('burst')));
      expect(events).toEqual(['open']);
      expect((await breaker.snapshot(key)).state).toBe('open');
      expect((await breaker.acquire(key, CFG)).allowed).toBe(false);
    });

    it('keeps upstreams independent of each other', async () => {
      const a = uniq(); const b = uniq();
      await fail(a, 3);
      expect((await breaker.acquire(a, CFG)).allowed).toBe(false);
      const lb = await breaker.acquire(b, CFG);
      expect(lb.allowed).toBe(true);
      await lb.success();
    });

    it('settles a lease only once', async () => {
      const key = uniq();
      const l = await breaker.acquire(key, CFG);
      await l.failure('x'); await l.failure('x'); await l.failure('x');
      expect((await breaker.snapshot(key)).consecutiveFailures).toBe(1);
    });

    it('lists states and supports a manual reset', async () => {
      const key = uniq();
      await fail(key, 3);
      const listed = (await breaker.list()).find((v) => v.key === key);
      expect(listed).toMatchObject({ state: 'open', consecutiveFailures: 3, timesOpened: 1 });
      expect(await breaker.reset(key)).toBe(true);
      expect((await breaker.acquire(key, CFG)).allowed).toBe(true);
    });
  });
}

suite('memory', async () => ({ breaker: new CircuitBreaker({ fallbackStore: new MemoryStore() }) }));

let redis;
suite('redis', async () => {
  redis = createClient({ url: redisUrl });
  redis.on('error', () => {});
  await redis.connect();
  return {
    breaker: new CircuitBreaker({ preferredStore: new RedisStore(redis), fallbackStore: new MemoryStore(), isPreferredUp: () => redis.isReady }),
    cleanup: async () => { const keys = await redis.keys('bx:cb:t-*'); if (keys.length) await redis.del(keys); await redis.quit(); },
  };
}, redisUp);

(redisUp ? describe : describe.skip)('circuit breaker (redis): shared state and failure modes', () => {
  let r1; let r2;
  beforeAll(async () => { r1 = createClient({ url: redisUrl }); r2 = createClient({ url: redisUrl }); [r1, r2].forEach((c) => c.on('error', () => {})); await r1.connect(); await r2.connect(); });
  afterAll(async () => { const keys = await r1.keys('bx:cb:t-*'); if (keys.length) await r1.del(keys); await r1.quit(); await r2.quit(); });

  it('shares state between two application instances (one opens it, the other is rejected)', async () => {
    const mk = (c) => new CircuitBreaker({ preferredStore: new RedisStore(c), isPreferredUp: () => c.isReady });
    const instanceA = mk(r1); const instanceB = mk(r2);
    const key = uniq();
    for (let i = 0; i < 3; i += 1) { const l = await instanceA.acquire(key, CFG); await l.failure('x'); }
    const viaB = await instanceB.acquire(key, CFG);
    expect(viaB).toMatchObject({ allowed: false, state: 'open', store: 'redis' });
    await sleep(CFG.openMs + 60);
    const probeB = await instanceB.acquire(key, { ...CFG, halfOpenMaxProbes: 1 });
    expect(probeB.probe).toBe(true);
    expect((await instanceA.acquire(key, { ...CFG, halfOpenMaxProbes: 1 })).allowed).toBe(false); // probe budget is global
  });

  it('degrades to per-process memory when Redis commands fail, and says so', async () => {
    const broken = { eval: async () => { throw new Error('redis down'); }, hGetAll: async () => { throw new Error('redis down'); }, scan: async () => { throw new Error('redis down'); }, del: async () => { throw new Error('redis down'); } };
    const b = new CircuitBreaker({ preferredStore: new RedisStore(broken), fallbackStore: new MemoryStore(), isPreferredUp: () => true });
    const key = uniq();
    for (let i = 0; i < 3; i += 1) { const l = await b.acquire(key, CFG); expect(l.store).toBe('memory'); await l.failure('x'); }
    const rejected = await b.acquire(key, CFG);
    expect(rejected).toMatchObject({ allowed: false, state: 'open', store: 'memory' });
    expect((await b.list()).find((v) => v.key === key).store).toBe('memory');
  });

  it('uses memory while Redis is reported disconnected, and does not hang on a stalled Redis', async () => {
    const down = new CircuitBreaker({ preferredStore: new RedisStore(r1), isPreferredUp: () => false });
    expect((await down.acquire(uniq(), CFG)).store).toBe('memory');
    expect(down.mode()).toBe('memory-fallback');
    const stalled = new CircuitBreaker({ preferredStore: new RedisStore({ eval: () => new Promise(() => {}) }), isPreferredUp: () => true, storeTimeoutMs: 80 });
    const t = Date.now();
    const l = await stalled.acquire(uniq(), CFG);
    expect(l).toMatchObject({ allowed: true, store: 'memory' });
    expect(Date.now() - t).toBeLessThan(500);
  });
});
