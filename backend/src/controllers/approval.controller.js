import { randomUUID } from "node:crypto";
import { ApprovalRequest } from "../models/approvalRequest.model.js";
import { FeatureFlag } from "../models/featureFlag.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { withMongoTransaction, inSession, createInSession } from "../utils/withMongoTransaction.js";
import { createAuditLogInSession } from "../utils/auditLog.js";
import { invalidateFeatureFlagCache, updateFeatureFlagSettings } from "../services/featureFlag.service.js";
import { getApprovalStalenessViolation } from "../utils/approvalPolicy.js";

const validateTargeting = (payload) => {
  const explicit = payload?.explicit;
  const rules = payload?.rules;
  if (explicit !== undefined && (!explicit || typeof explicit !== "object" || Array.isArray(explicit))) {
    throw new ApiError(400, "explicit targeting must be an object");
  }
  if (explicit && ((explicit.roles !== undefined && !Array.isArray(explicit.roles)) || (explicit.userIds !== undefined && !Array.isArray(explicit.userIds)))) {
    throw new ApiError(400, "Targeting roles and userIds must be arrays");
  }
  if (explicit?.roles?.length > 100 || explicit?.userIds?.length > 1000) throw new ApiError(400, "Targeting supports at most 100 roles and 1,000 user IDs");
  if (explicit?.roles?.some((value) => typeof value !== "string" || value.length > 100) || explicit?.userIds?.some((value) => typeof value !== "string" || value.length > 200)) {
    throw new ApiError(400, "Targeting values must be strings within the supported length");
  }
  if (rules !== undefined && (!Array.isArray(rules) || rules.length > 100)) throw new ApiError(400, "Targeting rules must be an array of at most 100 entries");
  if (Array.isArray(rules) && rules.some((rule) => !rule || typeof rule.field !== "string" || !rule.field.trim() || rule.field.length > 100 || ["__proto__", "prototype", "constructor"].some((part) => rule.field.split(".").includes(part)) || (rule.operator || "equals") !== "equals" || typeof rule.value !== "string" || rule.value.length > 200)) {
    throw new ApiError(400, "Each targeting rule requires a safe field path, equals operator, and string value (max 200 characters)");
  }
};

const snapshotForCopy = (flag) => ({
  name: flag.name, key: flag.key, description: flag.description, type: flag.type,
  value: flag.value, defaultValue: flag.defaultValue,
  targeting: flag.targeting?.toObject ? flag.targeting.toObject() : flag.targeting,
  rolloutPercentage: flag.rolloutPercentage,
});

export const submitProductionChangeRequest = asyncHandler(async (req, res) => {
  const { flagId, action, payload = {} } = req.body || {};
  if (!flagId) throw new ApiError(400, "flagId is required");
  if (!new Set(["UPDATE_SETTINGS", "UPDATE_TARGETING", "TOGGLE_FLAG", "COPY_TO_ENVIRONMENT"]).has(action)) {
    throw new ApiError(400, "Unsupported production change request action");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ApiError(400, "payload must be an object");

  const flag = await FeatureFlag.findOne({ _id: flagId, projectId: req.project._id });
  if (!flag) throw new ApiError(404, "Feature flag not found in this project");

  let sourceSnapshot = null;
  if (action === "COPY_TO_ENVIRONMENT") {
    if (flag.environment !== "dev") throw new ApiError(400, "Only a Development flag can be requested for Production copy");
    sourceSnapshot = snapshotForCopy(flag);
  } else if (flag.environment !== "prod") {
    throw new ApiError(400, "Production change requests must target a Production flag");
  }

  if (action === "UPDATE_SETTINGS") {
    const allowed = new Set(["enabled", "rolloutPercentage", "description", "value"]);
    const keys = Object.keys(payload);
    if (!keys.length || keys.some((key) => !allowed.has(key))) throw new ApiError(400, "Settings request contains no changes or unsupported fields");
    if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") throw new ApiError(400, "enabled must be a boolean");
    if (payload.rolloutPercentage !== undefined && (typeof payload.rolloutPercentage !== "number" || !Number.isFinite(payload.rolloutPercentage) || payload.rolloutPercentage < 0 || payload.rolloutPercentage > 100)) throw new ApiError(400, "rolloutPercentage must be between 0 and 100");
    if (payload.description !== undefined && (typeof payload.description !== "string" || payload.description.length > 500)) throw new ApiError(400, "description must be a string of at most 500 characters");
    if (payload.value !== undefined) {
      const typeOk = flag.type === "boolean" ? typeof payload.value === "boolean"
        : flag.type === "string" ? typeof payload.value === "string"
        : flag.type === "number" ? typeof payload.value === "number" && Number.isFinite(payload.value)
        : flag.type === "json" ? payload.value !== null && typeof payload.value === "object"
        : false;
      if (!typeOk) throw new ApiError(400, `value must match the ${flag.type} flag type`);
      if (Buffer.byteLength(JSON.stringify(payload.value)) > 64 * 1024) throw new ApiError(400, "Flag value must not exceed 64 KB");
    }
  }
  if (action === "UPDATE_TARGETING") validateTargeting(payload);
  if (action === "TOGGLE_FLAG" && typeof payload.enabled !== "boolean") throw new ApiError(400, "TOGGLE_FLAG requires a boolean enabled value");

  const request = await withMongoTransaction(async (session) => {
    const created = await createInSession(ApprovalRequest, {
      projectId: req.project._id, flagId: flag._id, requestedBy: req.user._id,
      action, targetEnvironment: "prod", payload, sourceSnapshot,
      baseUpdatedAt: action === "COPY_TO_ENVIRONMENT" ? null : flag.updatedAt,
      baseVersion: action === "COPY_TO_ENVIRONMENT" ? null : flag.__v,
    }, session);
    await createAuditLogInSession({
      projectId: req.project._id, flagId: flag._id, action: "APPROVAL_REQUESTED",
      changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null,
      after: { approvalRequestId: created._id, action, payload, targetEnvironment: "prod" },
    }, session);
    return created;
  });
  return res.status(201).json(new ApiResponse(201, request, "Production change submitted for Owner/Admin approval"));
});

export const listProductionApprovalRequests = asyncHandler(async (req, res) => {
  const status = req.query.status || "pending";
  if (!["pending", "processing", "approved", "rejected", "failed", "all"].includes(status)) throw new ApiError(400, "Invalid approval status");
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const filter = { projectId: req.project._id };
  if (status === "pending") {

    const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
    filter.$or = [
      { status: "pending" },
      { status: "processing", processingAt: { $lte: staleBefore } },
      { status: "processing", processingAt: null },
    ];
  } else if (status !== "all") {
    filter.status = status;
  }
  const requests = await ApprovalRequest.find(filter)
    .populate({ path: "flagId", select: "name key environment type" })
    .populate({ path: "requestedBy", select: "name email" })
    .populate({ path: "reviewedBy", select: "name email" })
    .sort({ createdAt: -1 }).limit(limit).lean();
  return res.status(200).json(new ApiResponse(200, requests, "Production approval requests loaded"));
});

const applyRequest = async (request, reviewerId, reviewerRole, requestId, session) => {
  const flag = await inSession(FeatureFlag.findOne({ _id: request.flagId, projectId: request.projectId }), session);
  if (!flag && request.action !== "COPY_TO_ENVIRONMENT") throw new ApiError(404, "The requested feature flag no longer exists");

  const staleReason = getApprovalStalenessViolation({
    action: request.action,
    baseUpdatedAt: request.baseUpdatedAt,
    currentUpdatedAt: flag?.updatedAt,
    baseVersion: request.baseVersion,
    currentVersion: flag?.__v,
  });
  if (staleReason) throw new ApiError(409, staleReason);

  if (request.action === "UPDATE_SETTINGS") {
    const applied = await updateFeatureFlagSettings(flag._id, request.payload, reviewerRole, reviewerId, request.projectId, { session, requestId });
    return { result: applied, cacheKey: applied.key };
  }
  if (request.action === "TOGGLE_FLAG") {
    const applied = await updateFeatureFlagSettings(flag._id, { enabled: request.payload.enabled }, reviewerRole, reviewerId, request.projectId, { session, requestId });
    return { result: applied, cacheKey: applied.key };
  }
  if (request.action === "UPDATE_TARGETING") {
    const before = flag.toObject();
    validateTargeting(request.payload);
    if (request.payload.explicit !== undefined) {
      flag.targeting.explicit = {
        roles: request.payload.explicit.roles || [],
        userIds: request.payload.explicit.userIds || [],
      };
    }
    if (request.payload.rules !== undefined) flag.targeting.rules = request.payload.rules;
    await flag.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId: request.projectId, flagId: flag._id, action: "UPDATE_TARGETING",
      changedBy: reviewerId, actorId: reviewerId, actorRole: reviewerRole, requestId, before, after: flag.toObject(),
    }, session);
    return { result: flag, cacheKey: flag.key };
  }
  if (request.action === "COPY_TO_ENVIRONMENT") {
    const snapshot = request.sourceSnapshot;
    if (!snapshot?.key || !snapshot?.type) throw new ApiError(400, "The submitted Development snapshot is incomplete");
    const existing = await inSession(FeatureFlag.findOne({ projectId: request.projectId, key: snapshot.key, environment: "prod" }), session);
    if (existing) throw new ApiError(409, "A Production flag with this key already exists");
    const copy = new FeatureFlag({
      projectId: request.projectId,
      ...snapshot,
      environment: "prod",
      enabled: false,
      rolloutPercentage: 0,
    });
    await copy.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId: request.projectId, flagId: copy._id, action: "COPY_TO_ENVIRONMENT",
      changedBy: reviewerId, actorId: reviewerId, actorRole: reviewerRole, requestId, before: null, after: copy.toObject(),
    }, session);
    return { result: copy, cacheKey: copy.key };
  }
  throw new ApiError(400, "Unsupported approval action");
};

export const approveProductionChangeRequest = asyncHandler(async (req, res) => {
  const processingToken = randomUUID();
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - 2 * 60 * 1000);

  const claimed = await withMongoTransaction(async (session) => inSession(ApprovalRequest.findOneAndUpdate(
    {
      _id: req.params.id,
      projectId: req.project._id,
      $or: [
        { status: "pending" },
        { status: "processing", processingAt: { $lte: staleProcessingBefore } },
        { status: "processing", processingAt: null },
      ],
    },
    { $set: { status: "processing", processingAt: now, processingToken, reviewedBy: req.user._id, reviewedAt: now, failureReason: "" } },
    { new: true },
  ), session));
  if (!claimed) throw new ApiError(409, "Approval request is not pending or is already being processed");

  try {
    const committed = await withMongoTransaction(async (session) => {
      const request = await inSession(ApprovalRequest.findOne({
        _id: claimed._id,
        projectId: req.project._id,
        status: "processing",
        processingToken,
      }), session);
      if (!request) throw new ApiError(409, "Approval processing lease expired or was replaced; retry the review");
      const applied = await applyRequest(request, req.user._id, req.projectRole, req.id, session);
      request.status = "approved";
      request.processingAt = null;
      request.processingToken = null;
      request.reviewComment = String(req.body?.comment || "").slice(0, 1000);
      await request.save(session ? { session } : undefined);
      await createAuditLogInSession({
        projectId: req.project._id,
        flagId: request.action === "COPY_TO_ENVIRONMENT" ? applied.result._id : request.flagId,
        action: "APPROVAL_APPROVED", changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id, before: null,
        after: { approvalRequestId: request._id, requestedAction: request.action, resultingFlagId: applied.result._id },
      }, session);
      return { request, result: applied.result, cacheKey: applied.cacheKey };
    });
    if (committed.cacheKey) await invalidateFeatureFlagCache(req.project._id, committed.cacheKey);
    return res.status(200).json(new ApiResponse(200, { request: committed.request, result: committed.result }, "Production change approved and applied"));
  } catch (error) {
    const failureReason = String(error?.message || "Approval could not be applied").slice(0, 500);
    await withMongoTransaction(async (session) => {
      const failed = await inSession(ApprovalRequest.findOneAndUpdate(
        { _id: claimed._id, projectId: req.project._id, status: "processing", processingToken },
        { $set: { status: "failed", processingAt: null, processingToken: null, failureReason } },
        { new: true },
      ), session);
      if (failed) {
        await createAuditLogInSession({
          projectId: req.project._id, flagId: failed.flagId, entityType: "approval_request", entityId: failed._id,
          action: "APPROVAL_FAILED", changedBy: req.user._id, actorId: req.user._id,
          actorRole: req.projectRole, requestId: req.id,
          before: { status: "processing" }, after: { status: "failed", failureReason },
        }, session);
      }
    }).catch((saveError) => console.error("Could not persist approval failure and audit record:", saveError.message));
    throw error;
  }
});

export const rejectProductionChangeRequest = asyncHandler(async (req, res) => {
  const comment = String(req.body?.comment || "").trim().slice(0, 1000);
  const request = await withMongoTransaction(async (session) => {
    const rejected = await inSession(ApprovalRequest.findOneAndUpdate(
      { _id: req.params.id, projectId: req.project._id, status: "pending" },
      { $set: { status: "rejected", reviewedBy: req.user._id, reviewedAt: new Date(), reviewComment: comment } },
      { new: true },
    ), session);
    if (!rejected) throw new ApiError(409, "Approval request is not pending or is already being processed");
    await createAuditLogInSession({
      projectId: req.project._id, flagId: rejected.flagId, action: "APPROVAL_REJECTED", changedBy: req.user._id, actorId: req.user._id, actorRole: req.projectRole, requestId: req.id,
      before: null, after: { approvalRequestId: rejected._id, requestedAction: rejected.action, comment },
    }, session);
    return rejected;
  });
  return res.status(200).json(new ApiResponse(200, request, "Production change request rejected"));
});
