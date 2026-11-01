import test from "node:test";
import assert from "node:assert/strict";
import {
  getProductionRolloutPolicyConfig,
  getProductionRolloutViolation,
} from "../src/utils/rolloutPolicy.js";

const DEFAULT_POLICY = { maxStep: 25, cooldownMs: 15 * 60 * 1000 };

test("production rollout increases are limited to the configured percentage-point step", () => {
  assert.equal(getProductionRolloutViolation({ current: 0, requested: 25 }), null);
  assert.match(getProductionRolloutViolation({ current: 0, requested: 26 }), /at most 25/);
  assert.equal(getProductionRolloutViolation({ current: 50, requested: 75 }), null);
  assert.match(getProductionRolloutViolation({ current: 50, requested: 76 }), /at most 25/);
});

test("production rollout cooldown blocks increases until the full interval expires", () => {
  const now = Date.now();
  assert.match(getProductionRolloutViolation({ current: 25, requested: 50, lastIncreaseAt: new Date(now - 60_000), now }), /cooling down/);
  assert.equal(getProductionRolloutViolation({ current: 25, requested: 50, lastIncreaseAt: new Date(now - 15 * 60_000), now }), null);
  assert.equal(getProductionRolloutViolation({ current: 25, requested: 50, lastIncreaseAt: new Date(now - 16 * 60_000), now }), null);
});

test("production rollout decreases are immediate, including during a cooldown or bad increase-policy configuration", () => {
  assert.equal(getProductionRolloutViolation({ current: 75, requested: 0, lastIncreaseAt: new Date(), now: Date.now() }), null);
  assert.equal(getProductionRolloutViolation({ current: 75, requested: 0, maxStep: 0, cooldownMs: -1 }), null);
});

test("invalid or future rollout timestamps fail closed on increases", () => {
  const now = Date.now();
  assert.match(getProductionRolloutViolation({ current: 25, requested: 50, lastIncreaseAt: "not-a-date", now }), /timestamp is invalid/);
  assert.match(getProductionRolloutViolation({ current: 25, requested: 50, lastIncreaseAt: new Date(now + 1000), now }), /timestamp is invalid/);
});

test("invalid rollout percentages and policy values are rejected", () => {
  assert.match(getProductionRolloutViolation({ current: -1, requested: 10 }), /Current rollout/);
  assert.match(getProductionRolloutViolation({ current: 10, requested: 101 }), /between 0 and 100/);
  assert.match(getProductionRolloutViolation({ current: 10, requested: 20, maxStep: 0 }), /misconfigured/);
  assert.match(getProductionRolloutViolation({ current: 10, requested: 20, cooldownMs: -1 }), /misconfigured/);
});

test("rollout policy configuration uses safe defaults and permits explicit zero cooldown", () => {
  assert.deepEqual(getProductionRolloutPolicyConfig({}), DEFAULT_POLICY);
  assert.deepEqual(getProductionRolloutPolicyConfig({ PROD_ROLLOUT_MAX_STEP: "10", PROD_ROLLOUT_COOLDOWN_MS: "0" }), { maxStep: 10, cooldownMs: 0 });
});

test("malformed rollout policy configuration fails closed", () => {
  assert.throws(() => getProductionRolloutPolicyConfig({ PROD_ROLLOUT_MAX_STEP: "abc" }), /PROD_ROLLOUT_MAX_STEP/);
  assert.throws(() => getProductionRolloutPolicyConfig({ PROD_ROLLOUT_MAX_STEP: "101" }), /PROD_ROLLOUT_MAX_STEP/);
  assert.throws(() => getProductionRolloutPolicyConfig({ PROD_ROLLOUT_COOLDOWN_MS: "-1" }), /PROD_ROLLOUT_COOLDOWN_MS/);
  assert.throws(() => getProductionRolloutPolicyConfig({ PROD_ROLLOUT_COOLDOWN_MS: "86400001" }), /PROD_ROLLOUT_COOLDOWN_MS/);
});
