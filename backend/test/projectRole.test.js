import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProjectRole,
  canAssignProjectRole,
  canRemoveProjectMember,
} from "../src/utils/projectRole.js";
import { requireRole } from "../src/middlewares/rbac.middleware.js";
import { ApiError } from "../src/utils/ApiError.js";

const project = {
  ownerId: "owner-1",
  members: [
    { userId: "admin-1", role: "admin" },
    { userId: "developer-1", role: "developer" },
    { userId: "viewer-1", role: "viewer" },
  ],
};

test("project role resolution is authoritative and distinguishes all four roles", () => {
  assert.equal(resolveProjectRole(project, "owner-1"), "owner");
  assert.equal(resolveProjectRole(project, "admin-1"), "admin");
  assert.equal(resolveProjectRole(project, "developer-1"), "developer");
  assert.equal(resolveProjectRole(project, "viewer-1"), "viewer");
  assert.equal(resolveProjectRole(project, "unknown-user"), null);
});

test("ambiguous or invalid membership fails closed", () => {
  assert.equal(resolveProjectRole({ ...project, members: [...project.members, { userId: "developer-1", role: "admin" }] }, "developer-1"), null);
  assert.equal(resolveProjectRole({ ...project, members: [{ userId: "broken-user", role: "owner" }] }, "broken-user"), null);
  assert.equal(resolveProjectRole(null, "owner-1"), null);
  assert.equal(resolveProjectRole(project, null), null);
});

test("Owner can assign and remove any supported member role", () => {
  for (const role of ["admin", "developer", "viewer"]) {
    assert.equal(canAssignProjectRole("owner", role), true);
    assert.equal(canRemoveProjectMember("owner", role), true);
  }
});

test("Admin can manage Developer and Viewer but cannot grant or remove Admin", () => {
  assert.equal(canAssignProjectRole("admin", "developer"), true);
  assert.equal(canAssignProjectRole("admin", "viewer"), true);
  assert.equal(canAssignProjectRole("admin", "admin"), false);
  assert.equal(canRemoveProjectMember("admin", "developer"), true);
  assert.equal(canRemoveProjectMember("admin", "viewer"), true);
  assert.equal(canRemoveProjectMember("admin", "admin"), false);
});

test("Developer and Viewer cannot manage project membership", () => {
  for (const actorRole of ["developer", "viewer", "unknown"]) {
    assert.equal(canAssignProjectRole(actorRole, "developer"), false);
    assert.equal(canRemoveProjectMember(actorRole, "viewer"), false);
  }
});

test("requireRole uses the project role, not the user/JWT role", () => {
  const middleware = requireRole(["owner"]);
  const req = { user: { role: "owner" }, project: { _id: "p1" }, projectRole: "viewer" };
  assert.throws(() => middleware(req, {}, () => {}), (error) => error instanceof ApiError && error.statusCode === 403);
});

test("requireRole fails when project authorization context is absent", () => {
  const middleware = requireRole(["admin"]);
  assert.throws(() => middleware({ user: { role: "admin" } }, {}, () => {}), (error) => error instanceof ApiError && error.statusCode === 403);
});

test("requireRole rejects invalid route policy at startup", () => {
  assert.throws(() => requireRole(["superuser"]), /valid project roles/);
  assert.throws(() => requireRole([]), /valid project roles/);
});
