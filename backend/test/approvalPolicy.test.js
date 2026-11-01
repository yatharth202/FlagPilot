import test from "node:test";
import assert from "node:assert/strict";
import { getApprovalStalenessViolation } from "../src/utils/approvalPolicy.js";

const version1 = new Date("2026-10-31T10:00:00.000Z");
const version2 = new Date("2026-10-31T10:05:00.000Z");

test("approval is valid when the Production flag is still at the submitted version", () => {
  assert.equal(getApprovalStalenessViolation({ action: "UPDATE_SETTINGS", baseVersion: 4, currentVersion: 4, baseUpdatedAt: version1, currentUpdatedAt: new Date(version1) }), null);
});

test("approval is rejected when the Production flag changed after submission", () => {
  assert.match(getApprovalStalenessViolation({ action: "UPDATE_TARGETING", baseVersion: 4, currentVersion: 5, baseUpdatedAt: version1, currentUpdatedAt: version1 }), /changed after this request/);
  // Version keys catch rapid changes even when updatedAt has the same millisecond value.
  assert.match(getApprovalStalenessViolation({ action: "UPDATE_TARGETING", baseVersion: 4, currentVersion: 5, baseUpdatedAt: version1, currentUpdatedAt: version1 }), /changed after this request/);
});

test("legacy requests without a base version fail closed", () => {
  assert.match(getApprovalStalenessViolation({ action: "TOGGLE_FLAG", baseVersion: null, currentVersion: 3, baseUpdatedAt: version1, currentUpdatedAt: version1 }), /no valid base version/);
});

test("invalid version metadata fails closed", () => {
  assert.match(getApprovalStalenessViolation({ action: "UPDATE_SETTINGS", baseVersion: 3, currentVersion: 3, baseUpdatedAt: "bad-date", currentUpdatedAt: version1 }), /invalid version metadata/);
});

test("Development-to-Production copies use their immutable submitted snapshot", () => {
  assert.equal(getApprovalStalenessViolation({ action: "COPY_TO_ENVIRONMENT", baseVersion: null, currentVersion: 2, baseUpdatedAt: null, currentUpdatedAt: version2 }), null);
});
