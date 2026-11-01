import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvitationAcceptUrl, generateInvitationToken, getInvitationTtlMs, hashInvitationToken,
  getInvitationResendCooldownRemainingMs, isInvitationUsable, isPendingInvitationDuplicateKeyError,
  isValidInvitationEmail, isValidInvitationToken, normalizeInvitationEmail,
} from "../src/utils/projectInvitationPolicy.js";

test("invitation emails are normalized and validated", () => {
  assert.equal(normalizeInvitationEmail("  Alice+dev@Example.com "), "alice+dev@example.com");
  assert.equal(isValidInvitationEmail("alice@example.com"), true);
  assert.equal(isValidInvitationEmail("alice@localhost"), false);
  assert.equal(isValidInvitationEmail("a\\b@example.com"), false);
  assert.equal(isValidInvitationEmail("x".repeat(250) + "@example.com"), false);
});

test("invitation tokens are high entropy, opaque, and stored as one-way hashes", () => {
  const token = generateInvitationToken();
  assert.equal(isValidInvitationToken(token), true);
  assert.notEqual(hashInvitationToken(token), token);
  assert.equal(hashInvitationToken(token).length, 64);
  assert.throws(() => hashInvitationToken("short"), /invalid/);
});

test("invitation lifetime is bounded to one hour through thirty days", () => {
  assert.equal(getInvitationTtlMs("1"), 60 * 60 * 1000);
  assert.equal(getInvitationTtlMs("168"), 168 * 60 * 60 * 1000);
  assert.equal(getInvitationTtlMs("720"), 720 * 60 * 60 * 1000);
  assert.throws(() => getInvitationTtlMs("0"), /between 1 and 720/);
  assert.throws(() => getInvitationTtlMs("721"), /between 1 and 720/);
  assert.throws(() => getInvitationTtlMs("1.5"), /between 1 and 720/);
});

test("only pending, unexpired invitations are usable", () => {
  const now = new Date("2026-10-31T00:00:00Z");
  assert.equal(isInvitationUsable({ status: "pending", expiresAt: new Date(now.getTime() + 1000) }, now), true);
  for (const status of ["accepted", "revoked", "expired"]) {
    assert.equal(isInvitationUsable({ status, expiresAt: new Date(now.getTime() + 1000) }, now), false);
  }
  assert.equal(isInvitationUsable({ status: "pending", expiresAt: new Date(now.getTime()) }, now), false);
});

test("invitation links use a fixed, validated frontend origin", () => {
  const token = generateInvitationToken();
  assert.equal(buildInvitationAcceptUrl("https://app.example.com", token), `https://app.example.com/invite/accept#token=${token}`);
  assert.throws(() => buildInvitationAcceptUrl("https://app.example.com/path", token), /exact HTTP\(S\) origin/);
  assert.throws(() => buildInvitationAcceptUrl("//attacker.example", token), /exact HTTP\(S\) origin/);
  assert.throws(() => buildInvitationAcceptUrl("https://app.example.com", "bad"), /token/);
  assert.throws(() => buildInvitationAcceptUrl("http://app.example.com", token, { production: true }), /HTTPS/);
});


test("invitation resend cooldown is persisted-time based and fails closed on invalid timestamps", () => {
  const now = Date.now();
  assert.equal(getInvitationResendCooldownRemainingMs(null, now), 0);
  assert.equal(getInvitationResendCooldownRemainingMs(new Date(now - 10_000), now), 50_000);
  assert.equal(getInvitationResendCooldownRemainingMs(new Date(now - 90_000), now), 0);
  assert.equal(getInvitationResendCooldownRemainingMs("not-a-date", now), 60_000);
});

test("only a duplicate pending project/email invitation index maps to a conflict", () => {
  assert.equal(isPendingInvitationDuplicateKeyError({ code: 11000, message: "duplicate key one_pending_invitation_per_project_email" }), true);
  assert.equal(isPendingInvitationDuplicateKeyError({ code: 11000, keyPattern: { projectId: 1, email: 1 } }), true);
  assert.equal(isPendingInvitationDuplicateKeyError({ code: 11000, keyPattern: { tokenHash: 1 } }), false);
  assert.equal(isPendingInvitationDuplicateKeyError({ code: 11000, message: "other unique index" }), false);
  assert.equal(isPendingInvitationDuplicateKeyError(new Error("duplicate")), false);
});
