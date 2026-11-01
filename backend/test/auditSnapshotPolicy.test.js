import test from "node:test";
import assert from "node:assert/strict";
import { boundAuditSnapshot } from "../src/utils/auditSnapshotPolicy.js";

test("audit snapshot policy preserves null and small snapshots", () => {
  assert.equal(boundAuditSnapshot(null), null);
  const snapshot = { enabled: true, rolloutPercentage: 25 };
  assert.equal(boundAuditSnapshot(snapshot), snapshot);
});

test("audit snapshot policy bounds large records and reports truncation", () => {
  const input = { payload: "x".repeat(20_000) };
  const result = boundAuditSnapshot(input);
  assert.equal(result.truncated, true);
  assert.ok(result.originalBytes > 16 * 1024);
  assert.ok(Buffer.byteLength(result.preview) <= 16 * 1024);
  const unicodeResult = boundAuditSnapshot({ payload: "🚀".repeat(10_000) });
  assert.ok(Buffer.byteLength(unicodeResult.preview) <= 16 * 1024);
});
