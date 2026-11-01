import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccessibleProjectsFilter,
  resolvePreferredProjectId,
  resolveRequestedProjectId,
} from "../src/utils/projectAccessPolicy.js";

test("accessible project query includes both owned and member projects", () => {
  const filter = buildAccessibleProjectsFilter("user-1");
  assert.deepEqual(filter, {
    archivedAt: null,
    $or: [{ ownerId: "user-1" }, { "members.userId": "user-1" }],
  });
});

test("default project prefers defaultProjectId and supports legacy projectId", () => {
  assert.equal(resolvePreferredProjectId({ defaultProjectId: "new", projectId: "old" }), "new");
  assert.equal(resolvePreferredProjectId({ projectId: "legacy" }), "legacy");
  assert.equal(resolvePreferredProjectId({}), null);
});

test("explicit project selector takes precedence but does not grant access", () => {
  assert.equal(resolveRequestedProjectId("project-b", { defaultProjectId: "project-a" }), "project-b");
  assert.equal(resolveRequestedProjectId("  ", { defaultProjectId: "project-a" }), "project-a");
  assert.equal(resolveRequestedProjectId(null, { projectId: "legacy" }), "legacy");
});

test("one user can resolve a different role in each project", async () => {
  const { resolveProjectRole } = await import("../src/utils/projectRole.js");
  const userId = "member-1";
  const projectA = { ownerId: "owner-a", members: [{ userId, role: "admin" }] };
  const projectB = { ownerId: "owner-b", members: [{ userId, role: "developer" }] };
  assert.equal(resolveProjectRole(projectA, userId), "admin");
  assert.equal(resolveProjectRole(projectB, userId), "developer");
});
