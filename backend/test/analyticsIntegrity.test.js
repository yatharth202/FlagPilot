import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalyticsAggregationPipeline,
  createAnalyticsFingerprint,
  isSameAnalyticsEvent,
  normalizeAnalyticsPayload,
} from "../src/utils/analyticsIntegrity.js";

const validPayload = (overrides = {}) => ({
  userId: "user-123",
  eventId: "purchase-event-0001",
  flagKey: "new_checkout",
  variant: "rollout",
  event: "exposure",
  metadata: { source: "checkout", attributes: { plan: "pro", country: "IN" } },
  ...overrides,
});

test("normalizes a valid analytics event and binds it to client-key environment", () => {
  const result = normalizeAnalyticsPayload(validPayload(), "dev");
  assert.equal(result.error, undefined);
  assert.equal(result.value.environment, "dev");
  assert.equal(result.value.flagKey, "new_checkout");
  assert.equal(result.value.userId, "user-123");
});

test("rejects shared anonymous identities instead of merging unrelated users", () => {
  for (const userId of ["anonymous", "anon", "ANONYMOUS"]) {
    const result = normalizeAnalyticsPayload(validPayload({ userId }), "dev");
    assert.match(result.error, /distinct stable userId/);
  }
});

test("rejects malformed IDs, unknown events, and unknown evaluation variants", () => {
  assert.match(normalizeAnalyticsPayload(validPayload({ eventId: "bad id" }), "dev").error, /eventId/);
  assert.match(normalizeAnalyticsPayload(validPayload({ event: "pageview" }), "dev").error, /event must be/);
  assert.match(normalizeAnalyticsPayload(validPayload({ variant: "not-a-decision" }), "dev").error, /variant/);
  assert.match(normalizeAnalyticsPayload(validPayload(), "stage").error, /environment/);
});

test("limits metadata size and rejects unsafe object keys", () => {
  const oversized = { note: "x".repeat(4100) };
  assert.match(normalizeAnalyticsPayload(validPayload({ metadata: oversized }), "dev").error, /4 KB/);

  const unsafe = JSON.parse('{"__proto__":{"isAdmin":true}}');
  assert.match(normalizeAnalyticsPayload(validPayload({ metadata: unsafe }), "dev").error, /unsafe key/);
});

test("fingerprints are stable when metadata key order changes", () => {
  const first = createAnalyticsFingerprint(validPayload());
  const second = createAnalyticsFingerprint(validPayload({ metadata: { attributes: { country: "IN", plan: "pro" }, source: "checkout" } }));
  assert.equal(first, second);
});

test("legacy rows without payloadHash can still be compared for idempotency", () => {
  const original = normalizeAnalyticsPayload(validPayload(), "dev").value;
  const storedLegacyRow = {
    userId: original.userId,
    flagKey: original.flagKey,
    environment: original.environment,
    variant: original.variant,
    event: original.event,
    metadata: original.metadata,
  };
  assert.equal(isSameAnalyticsEvent(storedLegacyRow, createAnalyticsFingerprint(original)), true);
});

test("same eventId with different event content is not treated as an identical retry", () => {
  const original = validPayload();
  const originalHash = createAnalyticsFingerprint(original);
  const sameEvent = { ...original, payloadHash: originalHash };
  const differentUser = { ...original, userId: "another-user" };
  const differentMetadata = { ...original, metadata: { source: "other" } };

  assert.equal(isSameAnalyticsEvent(sameEvent, createAnalyticsFingerprint(original)), true);
  assert.equal(isSameAnalyticsEvent(sameEvent, createAnalyticsFingerprint(differentUser)), false);
  assert.equal(isSameAnalyticsEvent(sameEvent, createAnalyticsFingerprint(differentMetadata)), false);
});

test("conversion fingerprint ignores client variant because server attribution wins", () => {
  const conversion = validPayload({ event: "conversion", variant: "control" });
  const alternateClientVariant = validPayload({ event: "conversion", variant: "rollout" });
  assert.equal(createAnalyticsFingerprint(conversion), createAnalyticsFingerprint(alternateClientVariant));
});

test("analytics aggregation counts events and unique users without large addToSet arrays", () => {
  const projectId = "project-1";
  const pipeline = buildAnalyticsAggregationPipeline({ projectId, flagKey: "new_checkout", environment: "prod" });
  assert.deepEqual(pipeline[0].$match, {
    projectId,
    flagKey: "new_checkout",
    environment: "prod",
    deduplicatedAt: null,
  });
  assert.deepEqual(pipeline[1].$group._id, { variant: "$variant", event: "$event", userId: "$userId" });
  assert.equal(pipeline[1].$group.eventCount.$sum, 1);
  assert.deepEqual(pipeline[2].$group._id, { variant: "$_id.variant", event: "$_id.event" });
  assert.equal(pipeline[2].$group.uniqueUsers.$sum, 1);
  assert.equal(JSON.stringify(pipeline).includes("$addToSet"), false);
});
