
import { FeatureFlag } from "../models/featureFlag.model.js";
import { ApiError } from "../utils/ApiError.js";
import { evaluateFlagDocument } from "./evaluationEngine.js";
import { AuditLog } from "../models/auditLog.model.js";
import cache from "../utils/memoryCache.js";
import { buildFeatureFlagCacheKey, normalizeFlagKey } from "../utils/featureFlagScope.js";
import { getProductionRolloutViolation, getProductionRolloutPolicyConfig } from "../utils/rolloutPolicy.js";
import { withMongoTransaction, inSession, createInSession } from "../utils/withMongoTransaction.js";
import { createAuditLogInSession } from "../utils/auditLog.js";

let lastCacheWarningAt = 0;
const warnCacheDegraded = (message, error) => {
  const now = Date.now();
  if (now - lastCacheWarningAt < 30_000) return;
  lastCacheWarningAt = now;
  console.error(message, error?.name || "CacheError");
};

export const invalidateFeatureFlagCache = async (projectId, key) => {
  const normalizedKey = normalizeFlagKey(key);
  const results = await Promise.all(["dev", "prod"].map(async (environment) => {
    try {
      await cache.invalidate(buildFeatureFlagCacheKey(projectId, normalizedKey, environment));
      return true;
    } catch (error) {

      warnCacheDegraded("Feature flag cache invalidation failed:", error);
      return false;
    }
  }));
  return results.every(Boolean);
};

const getFlagByKey = async (projectId, key, environment) => {
  const cacheKey = buildFeatureFlagCacheKey(projectId, key, environment);
  let cacheState = null;
  try {
    cacheState = await cache.getWithVersion(cacheKey);
    if (cacheState.hit) return cacheState.value;
  } catch (error) {

    warnCacheDegraded("Feature flag cache read failed; using MongoDB:", error);
  }

  const flag = await FeatureFlag.findOne({ projectId, key, environment }).lean();
  if (flag && cacheState) {
    try {
      await cache.setIfVersion(cacheKey, flag, cacheState.generation);
    } catch (error) {
      warnCacheDegraded("Feature flag cache write failed:", error);
    }
  }
  return flag;
};


const getLastRolloutIncreaseAt = async (flag, projectId, session, cooldownMs) => {
  if (flag.lastRolloutIncreaseAt) return flag.lastRolloutIncreaseAt;
  if (cooldownMs === 0) return null;

  const since = new Date(Date.now() - cooldownMs);
  const history = await inSession(AuditLog.find({
    projectId,
    flagId: flag._id,
    action: { $in: ["UPDATE_SETTINGS", "ROLLBACK"] },
    createdAt: { $gte: since },
  }).sort({ createdAt: -1 }).select("before after createdAt").lean(), session);

  const latestIncrease = history.find((entry) => {
    const before = Number(entry.before?.rolloutPercentage);
    const after = Number(entry.after?.rolloutPercentage);
    return Number.isFinite(before) && Number.isFinite(after) && after > before;
  });
  return latestIncrease?.createdAt || null;
};

const recordRolloutIncrease = (flag, previousValue, requestedValue, now = new Date()) => {
  if (requestedValue > previousValue) {
    flag.lastRolloutIncreaseAt = now;
    flag.lastRolloutIncreaseFrom = previousValue;
    flag.lastRolloutIncreaseTo = requestedValue;
  }
};

export const evaluateFeatureFlag = async ({ projectId, key, environment, userId, userAttributes = {} }) => {
  if (!projectId) throw new ApiError(401, "A project-scoped client key is required for evaluation");
  const normalizedKey = normalizeFlagKey(key);
  const selectedEnvironment = environment || "prod";
  const flag = await getFlagByKey(projectId, normalizedKey, selectedEnvironment);

  if (!flag) throw new ApiError(404, "Feature flag not found in this project and environment");
  return evaluateFlagDocument(flag, { key: normalizedKey, environment: selectedEnvironment, userId, userAttributes });
};

export const getFeatureFlagVersions = async (flagId, projectId, { page = 1, limit = 10 } = {}) => {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safeLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 10;
    const flag = await FeatureFlag.findOne({ _id: flagId, projectId })

    if(!flag){
        throw new ApiError(404,"Feature flag not found")
    }

    const skip = (safePage-1)*safeLimit

    const auditLog = await AuditLog.find({flagId, projectId})
        .populate({ path: "actorId", select: "name email" })
        .sort({createdAt: -1})
        .skip(skip)
        .limit(safeLimit)
        .lean()

    return auditLog.map(log =>({
        versionId: log._id,
        action: log.action,
        changedBy: log.changedBy,
        actor: log.actorId ? { id: log.actorId._id, name: log.actorId.name, email: log.actorId.email } : null,
        actorRole: log.actorRole || "unknown",
        requestId: log.requestId || null,
        createdAt: log.createdAt,
        snapshot: log.after
    }));
}

export const rollbackFeatureFlag = async (flagId, versionId, projectId, changedBy = "system", actorRole = "system", requestId = null) => {
  const result = await withMongoTransaction(async (session) => {
    const flag = await inSession(FeatureFlag.findOne({ _id: flagId, projectId }), session);
    if (!flag) throw new ApiError(404, "Feature flag not found");

    const versionLog = await inSession(AuditLog.findOne({ _id: versionId, flagId, projectId }), session);
    if (!versionLog) throw new ApiError(404, "Version not found");
    if (versionLog.flagId.toString() !== flagId.toString()) {
      throw new ApiError(400, "Version does not belong to this feature flag");
    }

    const beforeState = flag.toObject();
    const snapshot = versionLog.after;
    if (!snapshot || !snapshot.name || !snapshot.key || typeof snapshot.enabled !== "boolean") {
      throw new ApiError(400, "This historical entry does not contain a full flag snapshot and cannot be rolled back");
    }
    if (snapshot.environment !== flag.environment) {
      throw new ApiError(400, "Cannot rollback across different environments");
    }

    if (flag.environment === "prod") {
      const requestedRollout = Number(snapshot.rolloutPercentage ?? 0);
      const currentRollout = Number(flag.rolloutPercentage ?? 0);
      if (requestedRollout > currentRollout) {
        const { maxStep, cooldownMs } = getProductionRolloutPolicyConfig();
        const lastIncreaseAt = await getLastRolloutIncreaseAt(flag, projectId, session, cooldownMs);
        const violation = getProductionRolloutViolation({
          current: currentRollout, requested: requestedRollout,
          lastIncreaseAt, maxStep, cooldownMs,
        });
        if (violation) throw new ApiError(429, `Production rollback would violate staged rollout policy: ${violation}`);
      }
      if (snapshot.enabled === true && !flag.enabled && requestedRollout > 25) {
        throw new ApiError(400, "Cannot enable a Production flag above 25% during rollback; use staged rollout");
      }
    }

    flag.name = snapshot.name;
    flag.key = snapshot.key;
    flag.description = snapshot.description;
    flag.type = snapshot.type;
    flag.enabled = snapshot.enabled;
    flag.value = snapshot.value;
    flag.defaultValue = snapshot.defaultValue;
    flag.targeting = snapshot.targeting;
    flag.rolloutPercentage = snapshot.rolloutPercentage;
    flag.environment = snapshot.environment;
    recordRolloutIncrease(flag, Number(beforeState.rolloutPercentage ?? 0), Number(snapshot.rolloutPercentage ?? 0));
    await flag.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId, flagId, action: "ROLLBACK", changedBy, actorId: changedBy === "system" ? null : changedBy, actorRole, requestId, before: beforeState, after: flag.toObject(),
    }, session);
    return { flag, oldKey: beforeState.key, newKey: flag.key };
  });

  await invalidateFeatureFlagCache(projectId, result.oldKey);
  await invalidateFeatureFlagCache(projectId, result.newKey);
  return result.flag;
};

export const updateFeatureFlagSettings = async (flagId, updates, role = "system", changedBy = "system", projectId, { session: parentSession = null, requestId = null } = {}) => {
  const apply = async (session) => {
    const flag = await inSession(FeatureFlag.findOne({ _id: flagId, projectId }), session);
    if (!flag) throw new ApiError(404, "Feature flag not found");

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      throw new ApiError(400, "Settings payload must be an object");
    }
    const allowedFields = new Set(["enabled", "rolloutPercentage", "description", "value", "environment"]);
    const unknownFields = Object.keys(updates).filter((field) => !allowedFields.has(field));
    if (unknownFields.length) throw new ApiError(400, `Unsupported settings field(s): ${unknownFields.join(", ")}`);

    const { enabled, rolloutPercentage, description, value, environment } = updates;
    if (role === "developer" && flag.environment === "prod") {
      throw new ApiError(403, "Developers cannot directly change Production settings; submit an approval request");
    }
    if (role === "developer" && environment !== undefined) {
      throw new ApiError(403, "Developers cannot move flags between environments");
    }
    if (enabled !== undefined && typeof enabled !== "boolean") throw new ApiError(400, "enabled must be a boolean");
    if (rolloutPercentage !== undefined && (typeof rolloutPercentage !== "number" || !Number.isFinite(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100)) {
      throw new ApiError(400, "rolloutPercentage must be a number between 0 and 100");
    }
    if (description !== undefined && (typeof description !== "string" || description.length > 500)) {
      throw new ApiError(400, "description must be a string of at most 500 characters");
    }
    if (environment !== undefined && !["dev", "prod"].includes(environment)) {
      throw new ApiError(400, "environment must be dev or prod");
    }
    if (environment !== undefined && environment !== flag.environment) {
      throw new ApiError(400, "Environment is fixed when a flag is created. Create a corresponding flag in the other environment instead.");
    }
    if (value !== undefined) {
      const matchesType = flag.type === "boolean" ? typeof value === "boolean"
        : flag.type === "string" ? typeof value === "string"
        : flag.type === "number" ? typeof value === "number" && Number.isFinite(value)
        : flag.type === "json" ? value !== null && typeof value === "object"
        : false;
      if (!matchesType) throw new ApiError(400, `value must match the ${flag.type} flag type`);
      if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new ApiError(400, "Flag value must not exceed 64 KB");
    }
    if (flag.environment === "prod" && enabled === true && flag.enabled === false) {
      const effectiveRollout = rolloutPercentage ?? flag.rolloutPercentage ?? 0;
      if (effectiveRollout > 25) throw new ApiError(400, "Enable a Production flag only after staged rollout has reached 25% or less");
    }

    if (flag.environment === "prod" && rolloutPercentage !== undefined && rolloutPercentage > Number(flag.rolloutPercentage ?? 0)) {
      const { maxStep, cooldownMs } = getProductionRolloutPolicyConfig();
      const lastIncreaseAt = await getLastRolloutIncreaseAt(flag, projectId, session, cooldownMs);
      const violation = getProductionRolloutViolation({
        current: flag.rolloutPercentage ?? 0,
        requested: rolloutPercentage,
        lastIncreaseAt,
        maxStep,
        cooldownMs,
      });
      if (violation) throw new ApiError(429, violation);
    }

    const beforeState = flag.toObject();
    if (enabled !== undefined) flag.enabled = enabled;
    if (rolloutPercentage !== undefined) {
      const previousRollout = Number(flag.rolloutPercentage ?? 0);
      flag.rolloutPercentage = rolloutPercentage;
      if (flag.environment === "prod") recordRolloutIncrease(flag, previousRollout, rolloutPercentage);
    }
    if (description !== undefined) flag.description = description;
    if (value !== undefined) flag.value = value;
    await flag.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId, flagId: flag._id, action: "UPDATE_SETTINGS", changedBy, actorId: changedBy === "system" ? null : changedBy, actorRole: changedBy === "system" ? "system" : role, requestId, before: beforeState, after: flag.toObject(),
    }, session);
    return { flag, oldKey: beforeState.key, newKey: flag.key };
  };

  const result = parentSession
    ? await apply(parentSession)
    : await withMongoTransaction(apply);
  if (!parentSession) {
    await invalidateFeatureFlagCache(projectId, result.oldKey);
    await invalidateFeatureFlagCache(projectId, result.newKey);
  }
  return result.flag;
};
