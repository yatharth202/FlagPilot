import { Analytics } from "../models/analytics.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { FeatureFlag } from "../models/featureFlag.model.js";
import {buildAnalyticsAggregationPipeline,createAnalyticsFingerprint,isSameAnalyticsEvent,normalizeAnalyticsPayload,} from "../utils/analyticsIntegrity.js";

const duplicateResponse = (res, eventId) => res.status(200).json(
  new ApiResponse(200, { accepted: true, duplicate: true, eventId }, "Duplicate event ignored"),
);

const assertIdempotencyMatch = (existing, fingerprint) => {
  if (!isSameAnalyticsEvent(existing, fingerprint)) {
    throw new ApiError(409, "eventId was already used for different event data. Use a new eventId for a new event.");
  }
};

export const trackEvent = asyncHandler(async (req, res) => {
  const normalized = normalizeAnalyticsPayload(req.body || {}, req.sdkEnvironment);
  if (normalized.error) throw new ApiError(400, normalized.error);

  const event = normalized.value;
  const projectId = req.project._id;
  const payloadHash = createAnalyticsFingerprint(event);

  const priorEvent = await Analytics.findOne({ projectId, eventId: event.eventId }).lean();
  if (priorEvent) {
    assertIdempotencyMatch(priorEvent, payloadHash);
    return duplicateResponse(res, event.eventId);
  }

  const flagExists = await FeatureFlag.exists({ projectId, key: event.flagKey, environment: event.environment });
  if (!flagExists) throw new ApiError(404, "Feature flag not found in this project and environment");


  let attributedVariant = event.variant;
  if (event.event === "conversion") {
    const exposure = await Analytics.findOne({
      projectId,
      flagKey: event.flagKey,
      environment: event.environment,
      userId: event.userId,
      event: "exposure",
      deduplicatedAt: null,
    }).select("variant").lean();
    if (!exposure) throw new ApiError(409, "Record an exposure before tracking a conversion");
    attributedVariant = exposure.variant || "control";
  }

  try {
    const log = await Analytics.create({
      projectId,
      userId: event.userId,
      eventId: event.eventId,
      payloadHash,
      flagKey: event.flagKey,
      environment: event.environment,
      variant: attributedVariant,
      event: event.event,
      metadata: event.metadata,
    });
    return res.status(201).json(new ApiResponse(201, { ...log.toObject(), duplicate: false }, "Event tracked"));
  } catch (error) {
    if (error?.code !== 11000) throw error;


    const sameIdEvent = await Analytics.findOne({ projectId, eventId: event.eventId }).lean();
    if (sameIdEvent) {
      assertIdempotencyMatch(sameIdEvent, payloadHash);
      return duplicateResponse(res, event.eventId);
    }


    if (event.event === "exposure") {
      const existingExposure = await Analytics.findOne({
        projectId,
        flagKey: event.flagKey,
        environment: event.environment,
        userId: event.userId,
        event: "exposure",
        deduplicatedAt: null,
      }).select("_id").lean();
      if (existingExposure) return duplicateResponse(res, event.eventId);
    }

    throw error;
  }
});

export const getAnalytics = asyncHandler(async (req, res) => {
  const { key } = req.query;
  const environment = req.query.environment || "dev";
  if (typeof key !== "string" || !key.trim() || key.length > 100) throw new ApiError(400, "Flag key required");
  if (!["dev", "prod"].includes(environment)) throw new ApiError(400, "environment must be dev or prod");

  const normalizedKey = key.trim().toLowerCase();
  const flagExists = await FeatureFlag.exists({ projectId: req.project._id, key: normalizedKey, environment });
  if (!flagExists) throw new ApiError(404, "Feature flag not found in this project and environment");

  const pipeline = buildAnalyticsAggregationPipeline({
    projectId: req.project._id,
    flagKey: normalizedKey,
    environment,
  });
  const data = await Analytics.aggregate(pipeline).allowDiskUse(true);
  return res.status(200).json(new ApiResponse(200, data, "Analytics fetched"));
});

export const getLogs = asyncHandler(async (req, res) => {
  const environment = req.query.environment || "dev";
  if (!["dev", "prod"].includes(environment)) throw new ApiError(400, "environment must be dev or prod");
  
  const logs = await Analytics.find({ projectId: req.project._id, environment, deduplicatedAt: null })
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .lean();
  return res.status(200).json(new ApiResponse(200, logs, "Environment event logs fetched"));
});
