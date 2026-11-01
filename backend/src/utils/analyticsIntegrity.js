import { createHash } from "node:crypto";

export const ANALYTICS_EVENTS = new Set(["exposure", "conversion"]);
export const ANALYTICS_VARIANTS = new Set([
  "control",
  "rollout",
  "targeted_user",
  "targeted_role",
  "rule_match",

  "A",
]);
const UNSAFE_METADATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const stableSerialize = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const hasUnsafeMetadataKey = (value, depth = 0) => {
  if (depth > 10) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeMetadataKey(item, depth + 1));
  return Object.entries(value).some(([key, child]) => UNSAFE_METADATA_KEYS.has(key) || hasUnsafeMetadataKey(child, depth + 1));
};

/** Validate and normalize untrusted event-ingestion input. */
export const normalizeAnalyticsPayload = (body = {}, environment) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Event payload must be an object" };
  }
  if (!["dev", "prod"].includes(environment)) return { error: "Invalid client-key environment" };

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId || userId.length > 200 || /[\u0000-\u001f\u007f]/.test(userId)) {
    return { error: "A stable userId of 1-200 printable characters is required" };
  }
  if (["anonymous", "anon"].includes(userId.toLowerCase())) {
    return { error: "Use a distinct stable userId; shared anonymous identities cannot produce reliable analytics" };
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(eventId)) {
    return { error: "eventId is required and must be 8-128 safe characters" };
  }

  const flagKey = typeof body.flagKey === "string" ? body.flagKey.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(flagKey)) {
    return { error: "A valid flagKey is required" };
  }

  const event = body.event === undefined ? "exposure" : body.event;
  if (!ANALYTICS_EVENTS.has(event)) return { error: "event must be exposure or conversion" };

  const variant = body.variant === undefined ? "control" : body.variant;
  if (typeof variant !== "string" || !ANALYTICS_VARIANTS.has(variant)) {
    return { error: "variant must be one of control, rollout, targeted_user, targeted_role, or rule_match" };
  }

  const metadata = body.metadata === undefined ? {} : body.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { error: "metadata must be an object no larger than 4 KB" };
  }
  if (hasUnsafeMetadataKey(metadata)) return { error: "metadata contains an unsafe key or exceeds the supported nesting depth" };

  let metadataJson;
  try {
    metadataJson = JSON.stringify(metadata);
  } catch {
    return { error: "metadata must be valid JSON data" };
  }
  if (typeof metadataJson !== "string" || Buffer.byteLength(metadataJson, "utf8") > 4096) {
    return { error: "metadata must be an object no larger than 4 KB" };
  }

  return {
    value: {
      userId,
      eventId,
      flagKey,
      environment,
      event,
      variant,
      metadata,
    },
  };
};


export const createAnalyticsFingerprint = (event) => {
  const canonical = {
    event: event.event,
    userId: event.userId,
    flagKey: event.flagKey,
    environment: event.environment,
    ...(event.event === "exposure" ? { variant: event.variant || "control" } : {}),
    metadata: event.metadata || {},
  };
  return createHash("sha256").update(stableSerialize(canonical)).digest("hex");
};

export const isSameAnalyticsEvent = (existing, incomingFingerprint) => {
  const existingFingerprint = existing?.payloadHash || createAnalyticsFingerprint(existing || {});
  return existingFingerprint === incomingFingerprint;
};


export const buildAnalyticsAggregationPipeline = ({ projectId, flagKey, environment }) => ([
  {
    $match: {
      projectId,
      flagKey,
      environment,
      deduplicatedAt: null,
    },
  },
  {
    $group: {
      _id: { variant: "$variant", event: "$event", userId: "$userId" },
      eventCount: { $sum: 1 },
    },
  },
  {
    $group: {
      _id: { variant: "$_id.variant", event: "$_id.event" },
      count: { $sum: "$eventCount" },
      uniqueUsers: { $sum: 1 },
    },
  },
  { $sort: { "_id.variant": 1, "_id.event": 1 } },
]);
