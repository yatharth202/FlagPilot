import test from "node:test";
import assert from "node:assert/strict";
import { buildFeatureFlagCacheKey } from "../src/utils/featureFlagScope.js";
import { isEnvironmentAllowedForClientKey, resolveClientKeyEnvironment } from "../src/utils/clientKeyPolicy.js";

test("flag cache keys are isolated between projects, environments, and normalized keys", () => {
  const aDev = buildFeatureFlagCacheKey("project-a", " NEW_CHECKOUT ", "dev");
  assert.equal(aDev, "project-a:dev:new_checkout");
  assert.notEqual(aDev, buildFeatureFlagCacheKey("project-b", "new_checkout", "dev"));
  assert.notEqual(aDev, buildFeatureFlagCacheKey("project-a", "new_checkout", "prod"));
  assert.throws(() => buildFeatureFlagCacheKey("", "new_checkout", "dev"), /projectId is required/);
});

test("client keys resolve only to their configured environment", () => {
  const project = { devClientKey: "fp_dev_example", prodClientKey: "fp_prod_example" };
  assert.equal(resolveClientKeyEnvironment(project, "fp_dev_example"), "dev");
  assert.equal(resolveClientKeyEnvironment(project, "fp_prod_example"), "prod");
  assert.equal(resolveClientKeyEnvironment(project, "wrong"), null);
  assert.equal(isEnvironmentAllowedForClientKey("dev", "dev"), true);
  assert.equal(isEnvironmentAllowedForClientKey("dev", "prod"), false);
  assert.equal(isEnvironmentAllowedForClientKey(null, "dev"), false);
});

import { resolveProjectRole } from "../src/utils/projectRole.js";

test("project role distinguishes Owner, Admin, Developer, and Viewer", () => {
  const project = { ownerId: "owner-id", members: [
    { userId: "admin-id", role: "admin" },
    { userId: "developer-id", role: "developer" },
    { userId: "viewer-id", role: "viewer" },
  ] };
  assert.equal(resolveProjectRole(project, "owner-id"), "owner");
  assert.equal(resolveProjectRole(project, "admin-id"), "admin");
  assert.equal(resolveProjectRole(project, "developer-id"), "developer");
  assert.equal(resolveProjectRole(project, "viewer-id"), "viewer");
  assert.equal(resolveProjectRole(project, "stranger"), null);
});
