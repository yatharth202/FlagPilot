const DEFAULT_API_URL = "http://localhost:8000/api/v1";
const DEFAULT_CACHE_TTL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_CACHE_MAX_ENTRIES = 500;
const MAX_ATTRIBUTE_BYTES = 16 * 1024;
const MAX_ATTRIBUTE_DEPTH = 8;
const MAX_ATTRIBUTE_NODES = 500;
const ALLOWED_ENVIRONMENTS = new Set(["dev", "prod"]);
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const validateJsonObject = (value, label, maxBytes = MAX_ATTRIBUTE_BYTES) => {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  let nodes = 0;
  const visit = (current, depth) => {
    nodes += 1;
    if (nodes > MAX_ATTRIBUTE_NODES) throw new TypeError(`${label} contains too many values`);
    if (depth > MAX_ATTRIBUTE_DEPTH) throw new TypeError(`${label} is nested too deeply`);
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError(`${label} cannot contain non-finite numbers`);
      return;
    }
    if (typeof current !== "object" || (!Array.isArray(current) && !isPlainObject(current))) {
      throw new TypeError(`${label} must contain only JSON values`);
    }
    for (const key of Object.keys(current)) {
      if (UNSAFE_KEYS.has(key)) throw new TypeError(`${label} contains an unsafe object key`);
      visit(current[key], depth + 1);
    }
  };
  visit(value, 0);
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw new TypeError(`${label} must be serializable JSON`); }
  if (new TextEncoder().encode(serialized || "").byteLength > maxBytes) {
    throw new TypeError(`${label} must not exceed ${maxBytes / 1024} KB`);
  }
  return value;
};

const normalizeApiUrl = (url) => {
  let parsed;
  try { parsed = new URL(String(url || DEFAULT_API_URL)); }
  catch { throw new TypeError("apiBaseUrl must be a valid absolute URL"); }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const localHttp = parsed.protocol === "http:" && localHosts.has(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new TypeError("apiBaseUrl must use HTTPS, except for localhost development");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError("apiBaseUrl must not contain credentials, query parameters, or a fragment");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const apiPath = path.endsWith("/api/v1") ? path : `${path}/api/v1`;
  return `${parsed.origin}${apiPath}`;
};

const stableSerialize = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const retryAfterMs = (response) => {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2_000, seconds * 1_000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, Math.min(2_000, date - Date.now()));
  return null;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const makeEventId = () => globalThis.crypto?.randomUUID?.()
  || `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;


export class FlagPilotClient {
  constructor({
    apiBaseUrl = DEFAULT_API_URL,
    clientKey,
    clientKeys,
    environment = "prod",
    user = {},
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    onError = () => {},
  } = {}) {
    if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new TypeError("environment must be 'dev' or 'prod'");
    if (typeof fetchImpl !== "function") throw new TypeError("Fetch is not available; provide fetchImpl or use Node.js 18+");
    if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 60_000) throw new TypeError("cacheTtlMs must be between 0 and 60000");
    if (!Number.isInteger(cacheMaxEntries) || cacheMaxEntries < 1 || cacheMaxEntries > 10_000) throw new TypeError("cacheMaxEntries must be an integer between 1 and 10000");
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000) throw new TypeError("timeoutMs must be between 0 and 30000");
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) throw new TypeError("maxRetries must be an integer between 0 and 3");
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 2_000) throw new TypeError("retryDelayMs must be between 0 and 2000");
    if (typeof onError !== "function") throw new TypeError("onError must be a function");

    this.apiBaseUrl = normalizeApiUrl(apiBaseUrl);
    this.environment = environment;
    this.clientKeys = {};
    if (clientKeys !== undefined) {
      if (!isPlainObject(clientKeys)) throw new TypeError("clientKeys must be an object with dev/prod keys");
      for (const [keyEnvironment, keyValue] of Object.entries(clientKeys)) {
        if (!ALLOWED_ENVIRONMENTS.has(keyEnvironment) || typeof keyValue !== "string" || !keyValue.trim()) {
          throw new TypeError("clientKeys may contain only non-empty dev/prod keys");
        }
        this.clientKeys[keyEnvironment] = keyValue.trim();
      }
    }
    if (clientKey !== undefined) {
      if (typeof clientKey !== "string" || !clientKey.trim()) throw new TypeError("clientKey must be a non-empty string");
      if (this.clientKeys[environment] && this.clientKeys[environment] !== clientKey.trim()) {
        throw new TypeError(`clientKey conflicts with clientKeys.${environment}`);
      }
      this.clientKeys[environment] = clientKey.trim();
    }
    if (!this.clientKeys[environment]) {
      throw new TypeError(`clientKey is required: a client key for ${environment} must be configured from FlagPilot's SDK & API page`);
    }
    this.clientKey = this.clientKeys[environment];

    this.user = this._normalizeUser(user);
    this.cacheTtlMs = cacheTtlMs;
    this.cacheMaxEntries = cacheMaxEntries;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.fetch = fetchImpl;
    this.onError = onError;
    this.cache = new Map();
  }

  _normalizeUser(user) {
    if (user === undefined || user === null) return {};
    if (!isPlainObject(user)) throw new TypeError("user must be a plain object");
    if (user.id !== undefined && (typeof user.id !== "string" || !user.id.trim() || user.id.length > 200)) {
      throw new TypeError("user.id must be a non-empty string of at most 200 characters");
    }
    const attributes = validateJsonObject(user.attributes === undefined ? {} : user.attributes, "user.attributes");
    return { ...(user.id ? { id: user.id.trim() } : {}), attributes: { ...attributes } };
  }

  _reportError(error, context) {
    try { this.onError(error, context); }
    catch {  }
  }

  setUser(user) {
    this.user = this._normalizeUser(user);
    this.clearCache();
  }

  setEnvironment(environment) {
    if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new TypeError("environment must be 'dev' or 'prod'");
    const matchingKey = this.clientKeys[environment];
    if (!matchingKey) {
      throw new Error(`No ${environment} client key is configured. Pass clientKeys: { dev, prod } to switch environments safely.`);
    }
    this.environment = environment;
    this.clientKey = matchingKey;
    this.clearCache();
  }

  setClientKey(clientKey, environment = this.environment) {
    if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new TypeError("environment must be 'dev' or 'prod'");
    if (typeof clientKey !== "string" || !clientKey.trim()) throw new TypeError("clientKey must be a non-empty string");
    this.clientKeys[environment] = clientKey.trim();
    if (environment === this.environment) this.clientKey = clientKey.trim();
    this.clearCache();
  }

  invalidate(key) {
    const normalized = String(key || "").trim().toLowerCase();
    const prefix = `${JSON.stringify([this.environment, this.clientKey, normalized])}|`;
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(prefix)) this.cache.delete(cacheKey);
    }
  }

  clearCache() {
    this.cache.clear();
  }

  _cacheKey(key, attributes) {
    return `${JSON.stringify([this.environment, this.clientKey, key])}|${JSON.stringify(this.user?.id || null)}|${stableSerialize(attributes)}`;
  }

  _getCached(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  _setCached(key, value) {
    if (this.cacheTtlMs <= 0) return;
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    while (this.cache.size > this.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  async _fetchWithRetry(url, options, context) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller && this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;
      try {
        const response = await this.fetch(url, {
          ...options,
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response || typeof response.ok !== "boolean") throw new Error("Fetch returned an invalid response");
        if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === this.maxRetries) return response;
        const wait = retryAfterMs(response) ?? Math.min(2_000, this.retryDelayMs * (2 ** attempt));
        await sleep(wait);
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries) throw error;
        const wait = Math.min(2_000, this.retryDelayMs * (2 ** attempt));
        await sleep(wait);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw lastError || new Error(`Request failed: ${context.operation}`);
  }

  async evaluate(key, { skipCache = false, attributes = {} } = {}) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(normalizedKey)) {
      throw new TypeError("key must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens");
    }
    const suppliedAttributes = validateJsonObject(attributes, "attributes");
    const combinedAttributes = validateJsonObject({ ...(this.user?.attributes || {}), ...suppliedAttributes }, "attributes");
    const cacheKey = this._cacheKey(normalizedKey, combinedAttributes);
    if (!skipCache) {
      const cached = this._getCached(cacheKey);
      if (cached !== undefined) return cached;
    }

    try {
      const response = await this._fetchWithRetry(`${this.apiBaseUrl}/feature-flags/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-flagpilot-client-key": this.clientKey },
        body: JSON.stringify({
          key: normalizedKey,
          environment: this.environment,
          userId: this.user?.id || null,
          attributes: combinedAttributes,
        }),
      }, { operation: "evaluate", key: normalizedKey });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Flag evaluation failed with HTTP ${response.status}`);
      }
      const payload = await response.json();
      const decision = payload?.data;
      if (!decision || typeof decision.enabled !== "boolean" || !Object.prototype.hasOwnProperty.call(decision, "value")) {
        throw new Error("The evaluation API returned an invalid response");
      }
      this._setCached(cacheKey, decision);
      return decision;
    } catch (error) {
      this._reportError(error, { operation: "evaluate", key: normalizedKey });
      return { enabled: false, value: false, variant: "control", reason: "SDK_ERROR" };
    }
  }

  async getBooleanValue(key, fallback = false, options = {}) {
    const decision = await this.evaluate(key, options);
    if (decision.reason === "SDK_ERROR") return fallback;
    return typeof decision.value === "boolean" ? decision.value : fallback;
  }

  async getValue(key, fallback, options = {}) {
    const decision = await this.evaluate(key, options);
    return decision.reason === "SDK_ERROR" ? fallback : decision.value;
  }

  async trackEvent({ flagKey, event = "exposure", variant = "control", userId, eventId, metadata = {} } = {}) {
    const normalizedKey = String(flagKey || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(normalizedKey)) throw new TypeError("flagKey is invalid");
    if (!["exposure", "conversion"].includes(event)) throw new TypeError("event must be 'exposure' or 'conversion'");
    const stableUserId = userId || this.user?.id;
    if (typeof stableUserId !== "string" || !stableUserId.trim() || stableUserId.length > 200) {
      throw new TypeError("A stable userId is required to track analytics events");
    }
    if (["anonymous", "anon"].includes(stableUserId.trim().toLowerCase())) {
      throw new TypeError("Use a distinct stable userId; shared anonymous identities cannot produce reliable analytics");
    }
    const safeEventId = eventId === undefined || eventId === null ? makeEventId() : eventId;
    if (typeof safeEventId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(safeEventId)) throw new TypeError("eventId must be 8-128 safe characters");
    const allowedVariants = new Set(["control", "rollout", "targeted_user", "targeted_role", "rule_match", "A"]);
    if (typeof variant !== "string" || !allowedVariants.has(variant)) {
      throw new TypeError("variant must be one of control, rollout, targeted_user, targeted_role, or rule_match");
    }
    if (/[\u0000-\u001f\u007f]/.test(stableUserId)) throw new TypeError("userId must contain printable characters only");
    const safeMetadata = validateJsonObject(metadata, "metadata", 4 * 1024);

    try {
      const response = await this._fetchWithRetry(`${this.apiBaseUrl}/analytics/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-flagpilot-client-key": this.clientKey },
        body: JSON.stringify({
          userId: stableUserId.trim(),
          eventId: safeEventId,
          flagKey: normalizedKey,
          environment: this.environment,
          variant,
          event,
          metadata: safeMetadata,
        }),
      }, { operation: "trackEvent", key: normalizedKey, event });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Event tracking failed with HTTP ${response.status}`);
      }
      return response.json();
    } catch (error) {
      this._reportError(error, { operation: "trackEvent", key: normalizedKey, event });
      throw error;
    }
  }
}

export default FlagPilotClient;
