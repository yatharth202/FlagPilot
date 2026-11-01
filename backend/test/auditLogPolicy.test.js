import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAuditActor, normalizeAuditEntity } from "../src/utils/auditLogPolicy.js";

const userId = "0123456789abcdef01234567";

test("user audit actors require a valid id and authoritative project role", () => {
  assert.deepEqual(normalizeAuditActor({ actorId: userId, actorRole: "owner" }), {
    actorId: userId, actorType: "user", actorRole: "owner",
  });
  assert.throws(() => normalizeAuditActor({ actorId: "bad", actorRole: "admin" }), /valid user ObjectId/);
  assert.throws(() => normalizeAuditActor({ actorId: userId }), /authoritative project role/);
  assert.throws(() => normalizeAuditActor({ actorId: userId, actorRole: "superadmin" }), /authoritative project role/);
});

test("system records are clearly distinguished from user records", () => {
  assert.deepEqual(normalizeAuditActor(), { actorId: null, actorType: "system", actorRole: "system" });
  assert.deepEqual(normalizeAuditActor({ actorRole: "system" }), { actorId: null, actorType: "system", actorRole: "system" });
  assert.throws(() => normalizeAuditActor({ actorRole: "admin" }), /System audit entries/);
});

test("feature flag audit entries require a flag id", () => {
  assert.deepEqual(normalizeAuditEntity({ flagId: userId }), { entityType: "feature_flag", entityId: userId });
  assert.throws(() => normalizeAuditEntity({}), /entityId is required/);
});

test("project-level audit entries support typed entity references", () => {
  assert.deepEqual(normalizeAuditEntity({ entityType: "project_member", entityId: userId }), {
    entityType: "project_member", entityId: userId,
  });
  assert.throws(() => normalizeAuditEntity({ entityType: "unexpected", entityId: userId }), /Unsupported audit entityType/);
});


test("invitation acceptance has a distinct invited-user actor and entity type", () => {
  assert.deepEqual(normalizeAuditActor({ actorId: userId, actorRole: "invited" }), {
    actorId: userId, actorType: "user", actorRole: "invited",
  });
  assert.deepEqual(normalizeAuditEntity({ entityType: "project_invitation", entityId: userId }), {
    entityType: "project_invitation", entityId: userId,
  });
});
