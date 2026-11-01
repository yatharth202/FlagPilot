

export const FLAG_CACHE_TTL_MS = 5_000;
const KEY_PREFIX = "flagpilot:flag-cache:";
const GENERATION_PREFIX = `${KEY_PREFIX}generation:`;
const DATA_PREFIX = `${KEY_PREFIX}data:`;
const GENERATION_TTL_SECONDS = 60 * 60;
const MAX_LOCAL_ENTRIES = 10_000;

let store = new Map();
let generations = new Map();
let hits = 0;
let misses = 0;

const getRedisClient = async () => (await import("./redisClient.js")).getRedisClient();

const dataRedisKey = (key) => `${DATA_PREFIX}${key}`;
const generationRedisKey = (key) => `${GENERATION_PREFIX}${key}`;

const REDIS_SET_IF_VERSION = `
local current = redis.call('GET', KEYS[1])
if not current then current = '0' end
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1
`;

const REDIS_INVALIDATE = `
local generation = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
return generation
`;

const evictLocalEntries = () => {
  if (store.size <= MAX_LOCAL_ENTRIES) return;
  const excess = store.size - MAX_LOCAL_ENTRIES;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
};

const parseCacheEntry = (raw, generation) => {
  if (!raw) return undefined;
  try {
    const entry = JSON.parse(raw);
    if (!entry || entry.generation !== generation || !Object.prototype.hasOwnProperty.call(entry, "value")) return undefined;
    return entry.value;
  } catch {
    return undefined;
  }
};

const cache = {

  getWithVersion: async (key) => {
    if (process.env.REDIS_URL) {
      const client = await getRedisClient();
      const [raw, generationRaw] = await client.mGet([dataRedisKey(key), generationRedisKey(key)]);
      const generation = Number(generationRaw || 0);
      if (!Number.isSafeInteger(generation) || generation < 0) throw new Error("Invalid feature cache generation");
      const value = parseCacheEntry(raw, generation);
      if (value === undefined) { misses++; return { hit: false, value: undefined, generation }; }
      hits++;
      return { hit: true, value, generation };
    }

    const generation = generations.get(key) || 0;
    const entry = store.get(key);
    if (!entry || entry.generation !== generation || entry.expiresAt <= Date.now()) {
      if (entry) store.delete(key);
      misses++;
      return { hit: false, value: undefined, generation };
    }

    store.delete(key);
    store.set(key, entry);
    hits++;
    return { hit: true, value: entry.value, generation };
  },

  setIfVersion: async (key, value, expectedGeneration) => {
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) return false;
    const entry = { value, generation: expectedGeneration, setAt: Date.now() };
    if (process.env.REDIS_URL) {
      const client = await getRedisClient();
      const result = await client.eval(REDIS_SET_IF_VERSION, {
        keys: [generationRedisKey(key), dataRedisKey(key)],
        arguments: [String(expectedGeneration), JSON.stringify(entry), String(FLAG_CACHE_TTL_MS)],
      });
      return Number(result) === 1;
    }

    if ((generations.get(key) || 0) !== expectedGeneration) return false;
    store.set(key, { ...entry, expiresAt: Date.now() + FLAG_CACHE_TTL_MS });
    evictLocalEntries();
    return true;
  },


  invalidate: async (key) => {
    if (process.env.REDIS_URL) {
      const client = await getRedisClient();
      const result = await client.eval(REDIS_INVALIDATE, {
        keys: [generationRedisKey(key), dataRedisKey(key)],
        arguments: [String(GENERATION_TTL_SECONDS)],
      });
      return Number(result);
    }
    const next = (generations.get(key) || 0) + 1;
    generations.set(key, next);
    store.delete(key);
    return next;
  },


  get: async (key) => {
    const result = await cache.getWithVersion(key);
    return result.value;
  },
  set: async (key, value) => {
    const current = await cache.getWithVersion(key);
    return cache.setIfVersion(key, value, current.generation);
  },
  delete: async (key) => cache.invalidate(key),

  clear: async () => {
    if (process.env.REDIS_URL) {
      const client = await getRedisClient();
      const keys = [];
      for await (const key of client.scanIterator({ MATCH: `${KEY_PREFIX}*`, COUNT: 500 })) keys.push(key);
      for (let index = 0; index < keys.length; index += 500) {
        await client.del(keys.slice(index, index + 500));
      }
      return;
    }
    store = new Map();
    generations = new Map();
  },

  getMetrics: async () => {
    let keys = store.size;
    let cacheBackend = "memory";
    if (process.env.REDIS_URL) {
      cacheBackend = "redis";
      const client = await getRedisClient();
      keys = 0;
      for await (const _key of client.scanIterator({ MATCH: `${DATA_PREFIX}*`, COUNT: 500 })) keys++;
    }
    return { backend: cacheBackend, keys, hits, misses, ttlMs: FLAG_CACHE_TTL_MS };
  },
};

export default cache;
