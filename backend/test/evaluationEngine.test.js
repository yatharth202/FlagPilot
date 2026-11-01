import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { evaluateFlagDocument, validateUserAttributes } from "../src/services/evaluationEngine.js";
import { getUserRolloutBucket } from "../src/utils/hash.util.js";

const baseFlag = (overrides = {}) => ({
  key: "new_checkout",
  environment: "dev",
  enabled: true,
  value: true,
  defaultValue: false,
  rolloutPercentage: 100,
  targeting: { explicit: { roles: [], userIds: [] }, rules: [] },
  ...overrides,
});

test("disabled flag returns the safe default even when explicitly targeted", () => {
  const result = evaluateFlagDocument(baseFlag({ enabled: false, targeting: { explicit: { userIds: ["u1"], roles: ["beta"] } } }), {
    environment: "dev", userId: "u1", userAttributes: { role: "beta" },
  });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "FLAG_DISABLED");
  assert.equal(result.value, false);
});

test("environment mismatch fails closed", () => {
  const result = evaluateFlagDocument(baseFlag(), { environment: "prod", userId: "u1" });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "ENV_MISMATCH");
});

test("explicit user targeting takes precedence over zero-percent rollout and rules", () => {
  const result = evaluateFlagDocument(baseFlag({
    rolloutPercentage: 0,
    targeting: { explicit: { userIds: ["u1"], roles: [] }, rules: [{ field: "country", operator: "equals", value: "IN" }] },
  }), { environment: "dev", userId: "u1", userAttributes: { country: "US" } });
  assert.equal(result.enabled, true);
  assert.equal(result.reason, "TARGETED_USER");
});

test("role targeting takes precedence over percentage rollout and rules", () => {
  const result = evaluateFlagDocument(baseFlag({
    rolloutPercentage: 0,
    targeting: { explicit: { userIds: [], roles: ["beta"] }, rules: [{ field: "country", operator: "equals", value: "IN" }] },
  }), { environment: "dev", userId: "u2", userAttributes: { role: "beta", country: "US" } });
  assert.equal(result.enabled, true);
  assert.equal(result.reason, "TARGETED_ROLE");
});

test("configured rules gate percentage rollout so non-matching users cannot leak through", () => {
  const flag = baseFlag({ rolloutPercentage: 100, targeting: {
    explicit: { userIds: [], roles: [] },
    rules: [{ field: "country", operator: "equals", value: "IN" }],
  } });
  const eligible = evaluateFlagDocument(flag, { environment: "dev", userId: "u-IN", userAttributes: { country: "IN" } });
  const ineligible = evaluateFlagDocument(flag, { environment: "dev", userId: "u-US", userAttributes: { country: "US" } });
  assert.equal(eligible.enabled, true);
  assert.equal(eligible.reason, "ROLLOUT_MATCH");
  assert.equal(ineligible.enabled, false);
  assert.equal(ineligible.reason, "RULE_MISS");
});

test("all configured equals rules must match before percentage rollout", () => {
  const flag = baseFlag({ rolloutPercentage: 100, targeting: { explicit: { userIds: [], roles: [] }, rules: [
    { field: "country", operator: "equals", value: "IN" },
    { field: "plan.tier", operator: "equals", value: "pro" },
  ] } });
  assert.equal(evaluateFlagDocument(flag, { environment: "dev", userId: "u", userAttributes: { country: "IN", plan: { tier: "pro" } } }).reason, "ROLLOUT_MATCH");
  assert.equal(evaluateFlagDocument(flag, { environment: "dev", userId: "u", userAttributes: { country: "IN", plan: { tier: "free" } } }).reason, "RULE_MISS");
});

test("rules do not coerce objects into scalar strings", () => {
  const flag = baseFlag({ targeting: { explicit: { userIds: [], roles: [] }, rules: [
    { field: "plan", operator: "equals", value: "[object Object]" },
  ] } });
  const result = evaluateFlagDocument(flag, { environment: "dev", userId: "u", userAttributes: { plan: {} } });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "RULE_MISS");
});

test("percentage rollout is deterministic for a user and flag key", () => {
  const userId = "stable-user-42";
  const bucket = getUserRolloutBucket(userId, "new_checkout");
  const result = evaluateFlagDocument(baseFlag({ rolloutPercentage: bucket + 1 }), { environment: "dev", userId });
  assert.equal(result.enabled, true);
  assert.equal(result.reason, "ROLLOUT_MATCH");
  const miss = evaluateFlagDocument(baseFlag({ rolloutPercentage: bucket }), { environment: "dev", userId });
  assert.equal(miss.enabled, false);
  assert.equal(miss.reason, "ROLLOUT_MISS");
});

test("rollout hashing remains backward-compatible and stable across environments", () => {
  const legacyHash = crypto.createHash("sha256").update("same-user:same-flag").digest("hex");
  const expected = Number.parseInt(legacyHash.substring(0, 8), 16) % 100;
  assert.equal(getUserRolloutBucket("same-user", "same-flag"), expected);
  assert.equal(getUserRolloutBucket("same-user", "same-flag"), expected);
});

test("rollout percentage 100 includes every stable hash bucket", () => {
  for (const userId of ["a", "b", "c", "user-1000"]) {
    const result = evaluateFlagDocument(baseFlag({ rolloutPercentage: 100 }), { environment: "dev", userId });
    assert.equal(result.enabled, true);
  }
});

test("percentage rollout fails closed when a stable user ID is missing", () => {
  const result = evaluateFlagDocument(baseFlag({ rolloutPercentage: 50 }), { environment: "dev" });
  assert.equal(result.enabled, false);
  assert.equal(result.value, false);
  assert.equal(result.reason, "USER_ID_REQUIRED");
});

test("invalid stored rollout configuration fails closed instead of enabling everyone", () => {
  for (const rolloutPercentage of [101, -1, "100", Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = evaluateFlagDocument(baseFlag({ rolloutPercentage }), { environment: "dev", userId: "u1" });
    assert.equal(result.enabled, false);
    assert.equal(result.reason, "INVALID_ROLLOUT_CONFIGURATION");
  }
});

test("attributes must be bounded safe JSON objects", () => {
  assert.equal(validateUserAttributes({ plan: { tier: "pro" }, country: "IN" }), null);
  assert.match(validateUserAttributes([]), /plain object/);
  assert.match(validateUserAttributes({ nested: { constructor: "bad" } }), /unsafe/);
  assert.match(validateUserAttributes({ nested: { value: Number.POSITIVE_INFINITY } }), /finite numbers/);
  assert.match(validateUserAttributes({ blob: "x".repeat(17 * 1024) }), /16 KB/);
});
