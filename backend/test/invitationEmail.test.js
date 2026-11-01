import test from "node:test";
import assert from "node:assert/strict";
import { sendProjectInvitationEmail, isInvitationEmailConfigured } from "../src/services/invitationEmail.service.js";
import { generateInvitationToken } from "../src/utils/projectInvitationPolicy.js";

const base = { token: generateInvitationToken(), email: "new.user@example.com", projectName: "Payments & Checkout", inviterName: "Owner", role: "developer", expiresAt: new Date("2026-11-07T00:00:00Z") };

test("development without provider config returns a copyable URL without attempting network delivery", async () => {
  let called = false;
  const result = await sendProjectInvitationEmail({ ...base, env: { NODE_ENV: "development" }, fetchImpl: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.status, "not_configured");
  assert.match(result.invitationUrl, /^http:\/\/localhost:5173\/invite\/accept#token=/);
});

test("production requires a configured email provider", async () => {
  await assert.rejects(
    sendProjectInvitationEmail({ ...base, env: { NODE_ENV: "production" }, fetchImpl: async () => ({ ok: true }) }),
    (error) => error.statusCode === 503,
  );
});

test("configured provider receives escaped, bounded invitation content", async () => {
  let request;
  const result = await sendProjectInvitationEmail({
    ...base,
    env: { NODE_ENV: "production", RESEND_API_KEY: "provider-test-key", EMAIL_FROM: "FlagPilot <invites@example.com>", FRONTEND_ORIGIN: "https://app.example.com" },
    fetchImpl: async (url, options) => { request = { url, options, body: JSON.parse(options.body) }; return { ok: true, status: 200 }; },
  });
  assert.equal(result.status, "sent");
  assert.equal(result.invitationUrl, null);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.body.to[0], base.email);
  assert.match(request.body.html, /Payments &amp; Checkout/);
  assert.match(request.body.text, /https:\/\/app.example.com\/invite\/accept#token=/);
  assert.equal(request.options.headers.Authorization, "Bearer provider-test-key");
});

test("provider errors do not expose provider response bodies", async () => {
  await assert.rejects(
    sendProjectInvitationEmail({
      ...base,
      env: { NODE_ENV: "production", RESEND_API_KEY: "provider-test-key", EMAIL_FROM: "FlagPilot <invites@example.com>", FRONTEND_ORIGIN: "https://app.example.com" },
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => "sensitive provider response" }),
    }),
    (error) => error.statusCode === 502 && !error.message.includes("sensitive"),
  );
});

test("provider configuration requires key, sender and frontend origin", () => {
  assert.equal(isInvitationEmailConfigured({ RESEND_API_KEY: "x", EMAIL_FROM: "sender", FRONTEND_ORIGIN: "https://app.example.com" }), true);
  assert.equal(isInvitationEmailConfigured({ RESEND_API_KEY: "x", EMAIL_FROM: "sender" }), false);
});
