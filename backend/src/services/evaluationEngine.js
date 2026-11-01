import { getUserRolloutBucket } from "../utils/hash.util.js";

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_ATTRIBUTE_BYTES = 16 * 1024;
const MAX_ATTRIBUTE_DEPTH = 8;
const MAX_ATTRIBUTE_NODES = 500;

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};


export const validateUserAttributes = (attributes) => {
  if (!isPlainObject(attributes)) return "attributes must be a plain object";

  let nodes = 0;
  const visit = (value, depth) => {
    nodes += 1;
    if (nodes > MAX_ATTRIBUTE_NODES) return "attributes contain too many values";
    if (depth > MAX_ATTRIBUTE_DEPTH) return "attributes are nested too deeply";
    if (value === null || typeof value === "string" || typeof value === "boolean") return null;
    if (typeof value === "number") return Number.isFinite(value) ? null : "attributes must contain finite numbers";
    if (typeof value !== "object") return "attributes must contain only JSON values";
    if (!Array.isArray(value) && !isPlainObject(value)) return "attributes must contain only plain JSON objects";
    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) return "attributes contain an unsafe object key";
      const error = visit(value[key], depth + 1);
      if (error) return error;
    }
    return null;
  };

  const structuralError = visit(attributes, 0);
  if (structuralError) return structuralError;
  let serialized;
  try { serialized = JSON.stringify(attributes); }
  catch { return "attributes must be serializable JSON"; }
  if (Buffer.byteLength(serialized || "") > MAX_ATTRIBUTE_BYTES) return "attributes must not exceed 16 KB";
  return null;
};

const getAttributeValue = (attributes, path) => {
  if (typeof path !== "string" || !path.trim()) return undefined;
  const segments = path.split(".");
  if (segments.some((key) => UNSAFE_KEYS.has(key))) return undefined;
  return segments.reduce((current, key) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    return current[key];
  }, attributes);
};

const matchesRules = (rules, attributes) => {
  if (!Array.isArray(rules) || rules.length === 0) return false;


  return rules.every((rule) => {
    if (!rule || rule.operator !== "equals" || typeof rule.field !== "string" || !rule.field.trim()
      || rule.value === undefined || rule.value === null) return false;
    const actual = getAttributeValue(attributes, rule.field);
    if (actual === undefined || actual === null || !["string", "number", "boolean"].includes(typeof actual)) return false;
    if (typeof actual === "number" && !Number.isFinite(actual)) return false;
    return String(actual) === String(rule.value ?? "");
  });
};

const controlDecision = (value, reason) => ({
  enabled: false,
  value,
  variant: "control",
  reason,
});

export const evaluateFlagDocument = (flag, {
  key = flag?.key,
  environment = "prod",
  userId,
  userAttributes = {},
} = {}) => {
  const fallback = flag?.defaultValue ?? false;

  if (!flag) return controlDecision(false, "FLAG_NOT_FOUND");
  if (flag.environment !== environment) return controlDecision(fallback, "ENV_MISMATCH");


  if (flag.enabled !== true) return controlDecision(fallback, "FLAG_DISABLED");

  const stableUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
  const explicit = flag.targeting?.explicit || {};
  const userIds = Array.isArray(explicit.userIds) ? explicit.userIds : [];
  const roles = Array.isArray(explicit.roles) ? explicit.roles : [];


  if (stableUserId && userIds.includes(stableUserId)) {
    return { enabled: true, value: flag.value, variant: "targeted_user", reason: "TARGETED_USER" };
  }
  if (typeof userAttributes?.role === "string" && roles.includes(userAttributes.role)) {
    return { enabled: true, value: flag.value, variant: "targeted_role", reason: "TARGETED_ROLE" };
  }

  const rules = flag.targeting?.rules;
  if (Array.isArray(rules) && rules.length > 0 && !matchesRules(rules, userAttributes)) {
    return controlDecision(fallback, "RULE_MISS");
  }
  if (rules !== undefined && !Array.isArray(rules)) {
    return controlDecision(fallback, "INVALID_TARGETING_CONFIGURATION");
  }

  const rawRollout = flag.rolloutPercentage ?? 0;
  if (typeof rawRollout !== "number" || !Number.isFinite(rawRollout) || rawRollout < 0 || rawRollout > 100) {
    return controlDecision(fallback, "INVALID_ROLLOUT_CONFIGURATION");
  }
  if (rawRollout === 0) return controlDecision(fallback, "ROLLOUT_ZERO");
  if (!stableUserId) return controlDecision(fallback, "USER_ID_REQUIRED");

  const bucket = getUserRolloutBucket(stableUserId, key);
  if (bucket >= rawRollout) return controlDecision(fallback, "ROLLOUT_MISS");

  return { enabled: true, value: flag.value, variant: "rollout", reason: "ROLLOUT_MATCH" };
};
