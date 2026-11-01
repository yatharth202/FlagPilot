import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditFeedFilter, createAuditFeedCursor, parseAuditFeedQuery } from "../src/utils/auditFeedPolicy.js";

const projectId = "64b000000000000000000001";
const rowId = "64b000000000000000000002";

test("audit query defaults to a bounded page and project scope is mandatory", () => {
  const parsed = parseAuditFeedQuery({});
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.cursor, null);
  assert.deepEqual(buildAuditFeedFilter(projectId, parsed), { projectId });
});

test("audit query accepts a supported entity filter and pagination cursor", () => {
  const parsed = parseAuditFeedQuery({ limit: "25", entityType: "project_member" });
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.entityType, "project_member");
  const cursor = parseAuditFeedQuery({ cursor: createAuditFeedCursor({ _id: rowId, createdAt: "2026-10-31T00:00:00.000Z" }) }).cursor;
  const filter = buildAuditFeedFilter(projectId, { cursor, entityType: "project_member" });
  assert.equal(filter.projectId, projectId);
  assert.equal(filter.entityType, "project_member");
  assert.equal(filter.$or.length, 2);
});

test("audit query rejects unbounded limits, invalid entity filters and forged cursors", () => {
  assert.throws(() => parseAuditFeedQuery({ limit: "1000" }), /limit/);
  assert.throws(() => parseAuditFeedQuery({ limit: "2.5" }), /limit/);
  assert.throws(() => parseAuditFeedQuery({ entityType: "$where" }), /entityType/);
  assert.throws(() => parseAuditFeedQuery({ cursor: "not-a-cursor" }), /cursor/);
  assert.throws(() => parseAuditFeedQuery({ cursor: Buffer.from(JSON.stringify({ id: "not-object-id", createdAt: "invalid" })).toString("base64url") }), /cursor/);
});

test("cursor ties pagination to both timestamp and ObjectId for deterministic ordering", () => {
  const timestamp = "2026-10-31T11:00:00.000Z";
  const token = createAuditFeedCursor({ _id: rowId, createdAt: timestamp });
  const decoded = parseAuditFeedQuery({ cursor: token }).cursor;
  assert.equal(decoded.id, rowId);
  assert.equal(decoded.createdAt.toISOString(), timestamp);
});


test("GitHub integration entities are available in project audit filters", () => {
  for (const entityType of ["github_installation", "github_repository", "github_deployment"]) {
    assert.equal(parseAuditFeedQuery({ entityType }).entityType, entityType);
  }
});
