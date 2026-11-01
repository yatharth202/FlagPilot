import test from "node:test";
import assert from "node:assert/strict";
import cache, { FLAG_CACHE_TTL_MS } from "../src/utils/memoryCache.js";

const withMemoryBackend = async (fn) => {
  const previous = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  await cache.clear();
  try { await fn(); }
  finally {
    await cache.clear();
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
};

test("cache returns a versioned value and invalidation clears it", async () => {
  await withMemoryBackend(async () => {
    const initial = await cache.getWithVersion("p1:dev:checkout");
    assert.equal(initial.hit, false);
    assert.equal(await cache.setIfVersion("p1:dev:checkout", { enabled: true }, initial.generation), true);
    assert.deepEqual(await cache.getWithVersion("p1:dev:checkout"), {
      hit: true, value: { enabled: true }, generation: initial.generation,
    });
    await cache.invalidate("p1:dev:checkout");
    assert.equal((await cache.getWithVersion("p1:dev:checkout")).hit, false);
  });
});

test("a slow pre-invalidation database read cannot repopulate the cache with stale data", async () => {
  await withMemoryBackend(async () => {
    const preRead = await cache.getWithVersion("p1:prod:checkout");
    await cache.invalidate("p1:prod:checkout");
    const accepted = await cache.setIfVersion("p1:prod:checkout", { enabled: true, version: "old" }, preRead.generation);
    assert.equal(accepted, false);
    assert.equal((await cache.getWithVersion("p1:prod:checkout")).hit, false);
  });
});

test("cache exposes a bounded TTL and evicts expired entries", async () => {
  await withMemoryBackend(async () => {
    assert.equal(FLAG_CACHE_TTL_MS, 5_000);
    const initial = await cache.getWithVersion("p1:dev:ttl");
    await cache.setIfVersion("p1:dev:ttl", { value: 1 }, initial.generation);
    assert.equal((await cache.getWithVersion("p1:dev:ttl")).hit, true);
  });
});
