import test from "node:test";
import assert from "node:assert/strict";
import { JWT_POLICY, isValidTokenSubject, hasValidTokenClaims, isAuthVersionCurrent } from "../src/utils/jwtPolicy.js";

test("JWT policy pins HS256 and separates access and refresh audiences", () => {
  assert.equal(JWT_POLICY.algorithm, "HS256");
  assert.notEqual(JWT_POLICY.accessAudience, JWT_POLICY.refreshAudience);
  assert.equal(JWT_POLICY.accessTtl, "15m");
  assert.equal(JWT_POLICY.refreshTtl, "7d");
});

test("JWT subject must be a MongoDB ObjectId string", () => {
  assert.equal(isValidTokenSubject("507f1f77bcf86cd799439011"), true);
  assert.equal(isValidTokenSubject("not-an-id"), false);
  assert.equal(isValidTokenSubject(123), false);
});

test("access and refresh claims cannot be interchanged or forged with missing context", () => {
  const base = { sub: "507f1f77bcf86cd799439011", iss: JWT_POLICY.issuer, authVersion: 0 };
  const access = { ...base, tokenUse: "access", aud: JWT_POLICY.accessAudience };
  const refresh = { ...base, tokenUse: "refresh", aud: JWT_POLICY.refreshAudience };
  assert.equal(hasValidTokenClaims(access, "access", JWT_POLICY.accessAudience), true);
  assert.equal(hasValidTokenClaims(access, "refresh", JWT_POLICY.refreshAudience), false);
  assert.equal(hasValidTokenClaims(refresh, "refresh", JWT_POLICY.refreshAudience), true);
  assert.equal(hasValidTokenClaims({ ...access, iss: "other" }, "access", JWT_POLICY.accessAudience), false);
  assert.equal(hasValidTokenClaims({ ...access, sub: "bad" }, "access", JWT_POLICY.accessAudience), false);
});

test("auth version revokes stale access and refresh tokens immediately", () => {
  assert.equal(isAuthVersionCurrent(0, 0), true);
  assert.equal(isAuthVersionCurrent(2, 2), true);
  assert.equal(isAuthVersionCurrent(1, 2), false);
  assert.equal(isAuthVersionCurrent(2, undefined), false);
  assert.equal(isAuthVersionCurrent(0, -1), false);
});
