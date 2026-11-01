import test from "node:test";
import assert from "node:assert/strict";
import { buildRateLimitKey } from "../src/utils/rateLimitKey.js";

test("rate-limit keys hash identities instead of exposing emails or client keys", () => {
  const email = "customer@example.com";
  const clientKey = "fp_prod_secret-like-public-client-key";
  const emailKey = buildRateLimitKey("login-account", email);
  const clientKeyLimit = buildRateLimitKey("project-evaluation", clientKey);

  assert.equal(emailKey.key.includes(email), false);
  assert.equal(clientKeyLimit.key.includes(clientKey), false);
  assert.match(emailKey.digest, /^[a-f0-9]{64}$/);
  assert.notEqual(emailKey.key, buildRateLimitKey("login-account", "other@example.com").key);
  assert.notEqual(emailKey.key, buildRateLimitKey("other-namespace", email).key);
});

test("rate-limit namespace is normalized and bounded", () => {
  const result = buildRateLimitKey("  My Limiter!!  ", "id");
  assert.equal(result.namespace, "-my-limiter-");
  assert.ok(result.key.length < 120);
});
