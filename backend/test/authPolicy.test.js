import test from "node:test";
import assert from "node:assert/strict";
import { resolveRegistrationRole, normalizeLoginIdentifier, canUsePasswordLogin } from "../src/utils/authPolicy.js";

test("newly registered accounts own their isolated project", () => {
  assert.equal(resolveRegistrationRole({ email: "owner@example.com" }), "owner");
  assert.equal(resolveRegistrationRole({ email: "another@example.com", role: "viewer" }), "owner");
});

test("login identifiers are normalized and bounded before rate-limit keying", () => {
  assert.equal(normalizeLoginIdentifier("  PERSON@Example.COM "), "person@example.com");
  assert.equal(normalizeLoginIdentifier("x".repeat(255)), "invalid");
  assert.equal(normalizeLoginIdentifier({ $ne: null }), "invalid");
});

test("Google-only accounts cannot authenticate through the password endpoint", () => {
  assert.equal(canUsePasswordLogin({ storedPassword: undefined, passwordMatches: true }), false);
  assert.equal(canUsePasswordLogin({ storedPassword: null, passwordMatches: true }), false);
  assert.equal(canUsePasswordLogin({ storedPassword: "", passwordMatches: true }), false);
  assert.equal(canUsePasswordLogin({ storedPassword: "$2b$hash", passwordMatches: false }), false);
  assert.equal(canUsePasswordLogin({ storedPassword: "$2b$hash", passwordMatches: true }), true);
});
