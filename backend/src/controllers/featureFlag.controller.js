import { FeatureFlag } from "../models/featureFlag.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { evaluateFeatureFlag, getFeatureFlagVersions, rollbackFeatureFlag, updateFeatureFlagSettings, invalidateFeatureFlagCache } from "../services/featureFlag.service.js";
import { ApprovalRequest } from "../models/approvalRequest.model.js";
import { withMongoTransaction, inSession, createInSession } from "../utils/withMongoTransaction.js";
import { createAuditLogInSession } from "../utils/auditLog.js";
import { validateUserAttributes } from "../services/evaluationEngine.js";


const valueMatchesType = (type, value) => {
    if (type === "boolean") return typeof value === "boolean";
    if (type === "string") return typeof value === "string";
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "json") return value !== undefined && value !== null && typeof value === "object";
    return false;
};

const defaultValueForType = (type) => {
    if (type === "string") return "";
    if (type === "number") return 0;
    if (type === "json") return {};
    return false;
};

const enabledValueForType = (type) => {
    if (type === "string") return "enabled";
    if (type === "number") return 1;
    if (type === "json") return { enabled: true };
    return true;
};

export const createFeatureFlag = asyncHandler(async (req, res) => {
    const {
        name, key, description = "", type = "boolean", enabled = false,
        rolloutPercentage = 0, environment, value, defaultValue,
    } = req.body || {};

    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
        throw new ApiError(400, "Feature name is required and must be at most 80 characters");
    }
    if (typeof key !== "string" || !key.trim()) {
        throw new ApiError(400, "Feature key is required");
    }

    const normalizedKey = key.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(normalizedKey)) {
        throw new ApiError(400, "Feature key may contain letters, numbers, dots, underscores, and hyphens");
    }
    if (!["boolean", "string", "number", "json"].includes(type)) {
        throw new ApiError(400, "Invalid feature flag type");
    }
    if (environment !== undefined && !["dev", "prod"].includes(environment)) {
        throw new ApiError(400, "Environment must be dev or prod");
    }
    if (typeof enabled !== "boolean") {
        throw new ApiError(400, "enabled must be a boolean");
    }
    if (typeof rolloutPercentage !== "number" || !Number.isFinite(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) {
        throw new ApiError(400, "rolloutPercentage must be a number between 0 and 100");
    }
    if (typeof description !== "string" || description.length > 500) {
        throw new ApiError(400, "description must be a string of at most 500 characters");
    }

    const normalizedDefault = defaultValue === undefined ? defaultValueForType(type) : defaultValue;
    const normalizedValue = value === undefined ? enabledValueForType(type) : value;
    if (!valueMatchesType(type, normalizedValue) || !valueMatchesType(type, normalizedDefault)) {
        throw new ApiError(400, `value and defaultValue must match the selected ${type} flag type`);
    }
    if (Buffer.byteLength(JSON.stringify(normalizedValue)) > 64 * 1024 || Buffer.byteLength(JSON.stringify(normalizedDefault)) > 64 * 1024) {
        throw new ApiError(400, "Flag value and defaultValue must not exceed 64 KB each");
    }

    const targetEnvironment = environment || "prod";
    if (req.projectRole === "developer" && targetEnvironment !== "dev") {
        throw new ApiError(403, "Developers can create flags only in Development. Submit a Production change request instead.");
    }
    if (targetEnvironment === "prod" && (enabled !== false || rolloutPercentage !== 0)) {
        throw new ApiError(400, "Production flags must be created disabled with 0% rollout. Increase exposure through staged rollout after creation.");
    }
    const existingFlag = await FeatureFlag.findOne({ projectId: req.project._id, key: normalizedKey, environment: targetEnvironment });
    if (existingFlag) {
        throw new ApiError(409, "A feature flag with this key already exists in this environment");
    }

    const flag = await withMongoTransaction(async (session) => {
        const created = new FeatureFlag({
            projectId: req.project._id,
            name: name.trim(), key: normalizedKey, description, type, enabled,
            rolloutPercentage, environment: targetEnvironment,
            value: normalizedValue, defaultValue: normalizedDefault,
        });
        await created.save(session ? { session } : undefined);
        await createAuditLogInSession({
            projectId: req.project._id, flagId: created._id, action: "CREATE_FLAG",
            changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null, after: created.toObject(),
        }, session);
        return created;
    });

    return res.status(201).json(new ApiResponse(201, flag, "Feature flag created"));
});


export const copyFlagToEnvironment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { environment } = req.body || {};
  if (!["dev", "prod"].includes(environment)) throw new ApiError(400, "Target environment must be dev or prod");

  const result = await withMongoTransaction(async (session) => {
    const source = await inSession(FeatureFlag.findOne({ _id: id, projectId: req.project._id }), session);
    if (!source) throw new ApiError(404, "Feature flag not found");
    if (source.environment === environment) throw new ApiError(400, "Choose the other environment; this flag is already in the selected environment");

    if (req.projectRole === "developer" && environment === "prod") {
      const snapshot = {
        name: source.name, key: source.key, description: source.description, type: source.type,
        value: source.value, defaultValue: source.defaultValue,
        targeting: source.targeting?.toObject ? source.targeting.toObject() : source.targeting,
        rolloutPercentage: source.rolloutPercentage,
      };
      const approval = await createInSession(ApprovalRequest, {
        projectId: req.project._id, flagId: source._id, requestedBy: req.user._id,
        action: "COPY_TO_ENVIRONMENT", targetEnvironment: "prod", sourceSnapshot: snapshot, payload: {},
      }, session);
      await createAuditLogInSession({
        projectId: req.project._id, flagId: source._id, action: "APPROVAL_REQUESTED",
        changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null,
        after: { approvalRequestId: approval._id, action: approval.action, payload: snapshot },
      }, session);
      return { approval, sourceKey: source.key };
    }

    const existing = await inSession(FeatureFlag.findOne({ projectId: req.project._id, key: source.key, environment }), session);
    if (existing) throw new ApiError(409, `A flag named ${source.key} already exists in ${environment === "dev" ? "Development" : "Production"}`);

    const copy = new FeatureFlag({
      projectId: req.project._id, name: source.name, key: source.key, description: source.description,
      type: source.type, enabled: false, value: source.value, defaultValue: source.defaultValue,
      targeting: source.targeting?.toObject ? source.targeting.toObject() : source.targeting,
      rolloutPercentage: environment === "prod" ? 0 : source.rolloutPercentage,
      environment,
    });
    await copy.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId: req.project._id, flagId: copy._id, action: "COPY_TO_ENVIRONMENT",
      changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null, after: copy.toObject(),
    }, session);
    return { copy, sourceKey: source.key };
  });

  if (result.approval) {
    return res.status(202).json(new ApiResponse(202, result.approval, "Production copy submitted for approval"));
  }
  await invalidateFeatureFlagCache(req.project._id, result.copy.key);
  return res.status(201).json(new ApiResponse(201, result.copy, "Disabled environment copy created"));
});

export const getAllFeatureFlags = asyncHandler(async(req,res) => {
    const { environment } = req.query;

    if (environment && !["dev", "prod"].includes(environment)) {
        throw new ApiError(400, "Invalid environment");
    }

    const filter = environment ? { projectId: req.project._id, environment } : { projectId: req.project._id };
    const flags = await FeatureFlag.find(filter).sort({createdAt: -1});

    return res.
    status(200)
    .json(new ApiResponse(200,flags,"Feature flags fetched"));
})

export const updateTargeting = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { explicit, rules } = req.body || {};
  if (explicit === undefined && rules === undefined) throw new ApiError(400, "Provide explicit targeting or targeting rules to update");
  if (explicit !== undefined && (!explicit || typeof explicit !== "object" || Array.isArray(explicit))) {
    throw new ApiError(400, "explicit targeting must be an object");
  }
  if (explicit && ((explicit.roles !== undefined && !Array.isArray(explicit.roles)) || (explicit.userIds !== undefined && !Array.isArray(explicit.userIds)))) {
    throw new ApiError(400, "Targeting roles and userIds must be arrays");
  }
  if (explicit?.roles?.length > 100 || explicit?.userIds?.length > 1000) {
    throw new ApiError(400, "Targeting supports at most 100 roles and 1,000 user IDs");
  }
  if (Array.isArray(rules) && rules.length > 100) throw new ApiError(400, "Targeting supports at most 100 rules");
  if (rules !== undefined && !Array.isArray(rules)) throw new ApiError(400, "Targeting rules must be an array");
  if (Array.isArray(rules) && rules.some((rule) => !rule || typeof rule.field !== "string" || !rule.field.trim() || rule.field.length > 100 || ["__proto__", "prototype", "constructor"].some((part) => rule.field.split(".").includes(part)) || (rule.operator || "equals") !== "equals" || typeof rule.value !== "string" || rule.value.length > 200)) {
    throw new ApiError(400, "Each targeting rule requires a safe field, equals operator, and string value (max 200 characters)");
  }
  if (explicit?.roles?.some((item) => typeof item !== "string" || item.length > 100) || explicit?.userIds?.some((item) => typeof item !== "string" || item.length > 200)) {
    throw new ApiError(400, "Targeting values must be strings within the supported length");
  }

  const result = await withMongoTransaction(async (session) => {
    const flag = await inSession(FeatureFlag.findOne({ _id: id, projectId: req.project._id }), session);
    if (!flag) throw new ApiError(404, "Feature flag not found");
    const payload = {
      ...(explicit !== undefined ? { explicit } : {}),
      ...(rules !== undefined ? { rules } : {}),
    };
    if (req.projectRole === "developer" && flag.environment === "prod") {
      const approval = await createInSession(ApprovalRequest, {
        projectId: req.project._id, flagId: flag._id, requestedBy: req.user._id,
        action: "UPDATE_TARGETING", targetEnvironment: "prod", payload, baseUpdatedAt: flag.updatedAt, baseVersion: flag.__v,
      }, session);
      await createAuditLogInSession({
        projectId: req.project._id, flagId: flag._id, action: "APPROVAL_REQUESTED",
        changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null,
        after: { approvalRequestId: approval._id, action: approval.action, payload: approval.payload },
      }, session);
      return { approval };
    }

    const beforeState = flag.toObject();
    if (explicit !== undefined) {
      flag.targeting.explicit = { roles: explicit.roles || [], userIds: explicit.userIds || [] };
    }
    if (rules !== undefined) flag.targeting.rules = rules;
    await flag.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId: req.project._id, flagId: flag._id, action: "UPDATE_TARGETING",
      changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: beforeState, after: flag.toObject(),
    }, session);
    return { flag, key: flag.key };
  });

  if (result.approval) {
    return res.status(202).json(new ApiResponse(202, result.approval, "Production targeting submitted for approval"));
  }
  await invalidateFeatureFlagCache(req.project._id, result.key);
  return res.status(200).json(new ApiResponse(200, result.flag, "Targeting updated"));
});

export const getFeatureFlagVersionsController = asyncHandler(async(req,res) => {
    const {id} = req.params;
    const {page=1,limit=10} =req.query;

    const version = await getFeatureFlagVersions(id, req.project._id, {
        page: Number(page),
        limit: Number(limit),
    })

    return res.status(200).json(
        new ApiResponse(200,version,"Feature flag verion fetched successfully")
    )
})

export const rollbackFeatureFlagController = asyncHandler(async(req,res)=> {
    const {id} =req.params;
    const {versionId} =req.body;

    if(!versionId){
        throw new ApiError(400,"VersionId is required");
    }

    const updateFlag = await rollbackFeatureFlag(
        id,
        versionId,
        req.project._id,
        req.user._id,
        req.projectRole,
        req.id
    );

    return res.status(200).json(
        new ApiResponse(200,updateFlag,"Feature flag rolled back successfully")
    )

})


export const evaluatePublic = asyncHandler(async (req, res) => {
  const { key, userId, environment, attributes } = req.body || {};

  if (typeof key !== "string" || !key.trim() || key.length > 100) {
    throw new ApiError(400, "A valid flag key is required");
  }
  const requestedEnvironment = req.sdkEnvironment;
  if (environment && environment !== requestedEnvironment) {
    throw new ApiError(403, "Client key cannot evaluate the other environment");
  }
  if (attributes !== undefined) {
    const attributesError = validateUserAttributes(attributes);
    if (attributesError) throw new ApiError(400, attributesError);
  }
  if (userId !== undefined && userId !== null && (typeof userId !== "string" || userId.length > 200)) {
    throw new ApiError(400, "userId must be a string of at most 200 characters");
  }

  const result = await evaluateFeatureFlag({
    projectId: req.project._id,
    key,
    userId,
    environment: requestedEnvironment,
    userAttributes: attributes || {},
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Flag evaluated")
  );
});

export const updateFeatureFlagSettingsController = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const flag = await FeatureFlag.findOne({ _id: id, projectId: req.project._id });
  if (!flag) throw new ApiError(404, "Feature flag not found");

  if (req.projectRole === "developer" && flag.environment === "prod") {
    const payload = req.body || {};
    const allowed = new Set(["enabled", "rolloutPercentage", "description", "value"]);
    const keys = Object.keys(payload);
    if (!keys.length || keys.some((key) => !allowed.has(key))) throw new ApiError(400, "Settings request is empty or contains unsupported fields");
    if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") throw new ApiError(400, "enabled must be a boolean");
    if (payload.rolloutPercentage !== undefined && (typeof payload.rolloutPercentage !== "number" || !Number.isFinite(payload.rolloutPercentage) || payload.rolloutPercentage < 0 || payload.rolloutPercentage > 100)) throw new ApiError(400, "rolloutPercentage must be between 0 and 100");
    if (payload.description !== undefined && (typeof payload.description !== "string" || payload.description.length > 500)) throw new ApiError(400, "description must be a string of at most 500 characters");
    if (payload.value !== undefined && !valueMatchesType(flag.type, payload.value)) throw new ApiError(400, `value must match the ${flag.type} flag type`);
    const approval = await withMongoTransaction(async (session) => {
      const created = await createInSession(ApprovalRequest, {
        projectId: req.project._id, flagId: flag._id, requestedBy: req.user._id,
        action: "UPDATE_SETTINGS", targetEnvironment: "prod", payload, baseUpdatedAt: flag.updatedAt, baseVersion: flag.__v,
      }, session);
      await createAuditLogInSession({
        projectId: req.project._id, flagId: flag._id, action: "APPROVAL_REQUESTED",
        changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null,
        after: { approvalRequestId: created._id, action: created.action, payload: created.payload },
      }, session);
      return created;
    });
    return res.status(202).json(new ApiResponse(202, approval, "Production settings submitted for approval"));
  }

  const updated = await updateFeatureFlagSettings(
    id, req.body, req.projectRole, req.user._id, req.project._id, { requestId: req.id }
  );
  return res.status(200).json(new ApiResponse(200, updated, "Settings updated"));
});

export const toggleFeatureFlag = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") throw new ApiError(400, "'enabled' must be a boolean");

  const result = await withMongoTransaction(async (session) => {
    const flag = await inSession(FeatureFlag.findOne({ _id: id, projectId: req.project._id }), session);
    if (!flag) throw new ApiError(404, "Feature flag not found");
    if (req.projectRole === "developer" && flag.environment === "prod") {
      const approval = await createInSession(ApprovalRequest, {
        projectId: req.project._id, flagId: flag._id, requestedBy: req.user._id,
        action: "TOGGLE_FLAG", targetEnvironment: "prod", payload: { enabled }, baseUpdatedAt: flag.updatedAt, baseVersion: flag.__v,
      }, session);
      await createAuditLogInSession({
        projectId: req.project._id, flagId: flag._id, action: "APPROVAL_REQUESTED",
        changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null,
        after: { approvalRequestId: approval._id, action: approval.action, payload: approval.payload },
      }, session);
      return { approval };
    }
    if (flag.environment === "prod" && enabled && !flag.enabled && Number(flag.rolloutPercentage || 0) > 25) {
      throw new ApiError(400, "Enable a Production flag only after staged rollout has reached 25% or less");
    }

    const before = flag.toObject();
    flag.enabled = enabled;
    await flag.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId: req.project._id, flagId: flag._id, action: "TOGGLE_FLAG",
      changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before, after: flag.toObject(),
    }, session);
    return { flag, key: flag.key };
  });

  if (result.approval) return res.status(202).json(new ApiResponse(202, result.approval, "Production toggle submitted for approval"));
  await invalidateFeatureFlagCache(req.project._id, result.key);
  return res.status(200).json(new ApiResponse(200, result.flag, "Flag toggled successfully"));
});
