import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify as verifySignature } from "node:crypto";
import {
  hashGitHubState, isValidGitHubWebhookSignature, parseGitHubNumericId,
  validateGitHubRepositorySelection, normalizeGitHubDeploymentPayload, buildGitHubInstallUrl, isGitHubInstallationAccessibleToUser,
} from "../src/utils/githubPolicy.js";
import { buildGitHubAppJwt, buildGitHubOAuthAuthorizationUrl, isGitHubAppConfigured } from "../src/services/githubApp.service.js";
import { buildGitHubInstallationTransition } from "../src/utils/githubPolicy.js";

const validDeploymentPayload = () => ({
  installation: { id: 12345 },
  repository: { id: 90001, full_name: "acme/storefront" },
  deployment: {
    id: 50001,
    sha: "a".repeat(40),
    ref: "refs/heads/main",
    environment: "production",
    created_at: "2026-10-31T10:00:00.000Z",
  },
  deployment_status: {
    id: 70001,
    state: "success",
    description: "Deploy complete",
    environment_url: "https://shop.example.com",
    log_url: "https://github.com/acme/storefront/actions/runs/100",
    creator: { login: "release-bot" },
    updated_at: "2026-10-31T10:05:00.000Z",
  },
});

test("GitHub installation state is one-way hashed and rejects malformed input", () => {
  const state = "A".repeat(43);
  assert.equal(hashGitHubState(state), hashGitHubState(state));
  assert.notEqual(hashGitHubState(state), hashGitHubState("B".repeat(43)));
  assert.throws(() => hashGitHubState("short"), /state is invalid/);
});

test("GitHub webhook signatures use exact raw bytes and constant-time comparison", () => {
  const rawBody = Buffer.from('{"action":"ping"}', "utf8");
  const secret = "a-strong-github-webhook-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  assert.equal(isValidGitHubWebhookSignature(rawBody, signature, secret), true);
  assert.equal(isValidGitHubWebhookSignature(rawBody, signature, "wrong-secret-value"), false);
  assert.equal(isValidGitHubWebhookSignature(Buffer.from('{ "action":"ping"}'), signature, secret), false);
  assert.equal(isValidGitHubWebhookSignature(rawBody, "sha1=bad", secret), false);
  assert.equal(isValidGitHubWebhookSignature(rawBody, signature, "short"), false);
});

test("GitHub IDs must be positive safe integers", () => {
  assert.equal(parseGitHubNumericId("12345"), 12345);
  assert.throws(() => parseGitHubNumericId("0"), /positive safe integer/);
  assert.throws(() => parseGitHubNumericId("1e6"), /positive safe integer/);
  assert.throws(() => parseGitHubNumericId(Number.MAX_SAFE_INTEGER + 1), /positive safe integer/);
});

test("repository selection allows only unique repositories visible to that installation", () => {
  const available = [
    { id: 1, full_name: "acme/app" },
    { id: 2, full_name: "acme/api" },
  ];
  assert.deepEqual(validateGitHubRepositorySelection([2, "1"], available).map((repo) => repo.id), [2, 1]);
  assert.throws(() => validateGitHubRepositorySelection([1, 1], available), /duplicates/);
  assert.throws(() => validateGitHubRepositorySelection([3], available), /not available/);
  assert.throws(() => validateGitHubRepositorySelection("1", available), /must be an array/);
  assert.throws(() => validateGitHubRepositorySelection(Array.from({ length: 101 }, (_, i) => i + 1), available), /at most 100/);
});

test("deployment webhook normalization accepts safe data and drops non-HTTPS URLs", () => {
  const normalized = normalizeGitHubDeploymentPayload(validDeploymentPayload());
  assert.equal(normalized.installationId, 12345);
  assert.equal(normalized.repositoryId, 90001);
  assert.equal(normalized.state, "success");
  assert.equal(normalized.environmentUrl, "https://shop.example.com/");
  assert.equal(normalized.logUrl, "https://github.com/acme/storefront/actions/runs/100");
  const unsafe = validDeploymentPayload();
  unsafe.deployment_status.environment_url = "javascript:alert(1)";
  assert.equal(normalizeGitHubDeploymentPayload(unsafe).environmentUrl, null);
  unsafe.deployment_status.environment_url = "https://user:password@example.com/";
  assert.equal(normalizeGitHubDeploymentPayload(unsafe).environmentUrl, null);
  unsafe.deployment_status.environment_url = `https://example.com/${"x".repeat(1100)}`;
  assert.equal(normalizeGitHubDeploymentPayload(unsafe).environmentUrl, null);
});

test("deployment webhook rejects invalid state, SHA, repository and timestamp", () => {
  const invalidState = validDeploymentPayload();
  invalidState.deployment_status.state = "unknown";
  assert.throws(() => normalizeGitHubDeploymentPayload(invalidState), /Unsupported GitHub deployment state/);
  const invalidSha = validDeploymentPayload();
  invalidSha.deployment.sha = "not-a-sha";
  assert.throws(() => normalizeGitHubDeploymentPayload(invalidSha), /SHA is invalid/);
  const invalidRepo = validDeploymentPayload();
  invalidRepo.repository.full_name = "acme/repo?query=1";
  assert.throws(() => normalizeGitHubDeploymentPayload(invalidRepo), /repository name is invalid/);
  const invalidDate = validDeploymentPayload();
  invalidDate.deployment_status.updated_at = "not-a-date";
  assert.throws(() => normalizeGitHubDeploymentPayload(invalidDate), /timestamp is invalid/);
});

test("GitHub installation URL uses a validated slug and opaque state", () => {
  const url = new URL(buildGitHubInstallUrl({ appSlug: "flagpilot-release", state: "x".repeat(43) }));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/apps/flagpilot-release/installations/new");
  assert.equal(url.searchParams.get("state"), "x".repeat(43));
  assert.throws(() => buildGitHubInstallUrl({ appSlug: "https://evil.example", state: "x".repeat(43) }), /GITHUB_APP_SLUG is invalid/);
  assert.throws(() => buildGitHubInstallUrl({ appSlug: "flagpilot-release", state: "short" }), /state is invalid/);
});

test("GitHub App JWT uses RS256 and a short-lived issuer claim", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = buildGitHubAppJwt({ appId: "123456", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }), now: 1_800_000_000_000 });
  const [encodedHeader, encodedPayload, signature] = jwt.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, "123456");
  assert.equal(payload.exp - payload.iat, 600);
  assert.equal(verifySignature("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(signature, "base64url")), true);
  assert.throws(() => buildGitHubAppJwt({ appId: "bad", privateKey: "no key" }), /GITHUB_APP_ID/);
});

test("GitHub installation ID from the Setup URL is accepted only if the authenticated GitHub user can access it", () => {
  const userInstallations = [
    { id: 10, account: { id: 100 } },
    { id: 20, account: { id: 200 } },
  ];
  assert.equal(isGitHubInstallationAccessibleToUser(userInstallations, 20, 200), true);
  assert.equal(isGitHubInstallationAccessibleToUser(userInstallations, 20, 100), false);
  assert.equal(isGitHubInstallationAccessibleToUser(userInstallations, 999, 999), false);
  assert.equal(isGitHubInstallationAccessibleToUser([], 20, 200), false);
  assert.equal(isGitHubInstallationAccessibleToUser(userInstallations, 0, 100), false);
  assert.equal(isGitHubInstallationAccessibleToUser(userInstallations, 10, 0), false);
});

test("GitHub OAuth authorization URL binds redirect URI and one-time state", () => {
  const url = new URL(buildGitHubOAuthAuthorizationUrl({
    clientId: "Iv1.example-client",
    redirectUri: "https://api.example.com/api/v1/github/oauth/callback",
    state: "s".repeat(43),
  }));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "Iv1.example-client");
  assert.equal(url.searchParams.get("redirect_uri"), "https://api.example.com/api/v1/github/oauth/callback");
  assert.equal(url.searchParams.get("state"), "s".repeat(43));
  assert.equal(url.searchParams.get("allow_signup"), "false");
  assert.throws(() => buildGitHubOAuthAuthorizationUrl({ clientId: "x", redirectUri: "http://localhost/callback", state: "s".repeat(43) }), /must use HTTPS/);
});


test("installation lifecycle transitions preserve correct before and after snapshots", () => {
  const earlier = new Date("2026-10-30T10:00:00.000Z");
  const now = new Date("2026-10-31T10:00:00.000Z");
  const suspended = buildGitHubInstallationTransition({ action: "suspend", previousSuspendedAt: null, now });
  assert.deepEqual(suspended.before, { suspendedAt: null, disconnectedAt: null });
  assert.deepEqual(suspended.after, { suspendedAt: now, disconnectedAt: null });

  const resumed = buildGitHubInstallationTransition({ action: "unsuspend", previousSuspendedAt: earlier, now });
  assert.deepEqual(resumed.before, { suspendedAt: earlier, disconnectedAt: null });
  assert.deepEqual(resumed.after, { suspendedAt: null, disconnectedAt: null });

  const deleted = buildGitHubInstallationTransition({ action: "deleted", previousSuspendedAt: earlier, previousDisconnectedAt: null, now });
  assert.deepEqual(deleted.before, { suspendedAt: earlier, disconnectedAt: null });
  assert.deepEqual(deleted.after, { suspendedAt: now, disconnectedAt: now });
  assert.throws(() => buildGitHubInstallationTransition({ action: "created", now }), /Unsupported/);
  assert.throws(() => buildGitHubInstallationTransition({ action: "suspend", now: "not-a-date" }), /time is invalid/);
});

test("GitHub App configuration requires a valid RSA key and exact HTTPS OAuth callback path", () => {
  const envKeys = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_OAUTH_CALLBACK_URL"];
  const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  try {
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_APP_SLUG = "flagpilot-app";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.GITHUB_WEBHOOK_SECRET = "a".repeat(40);
    process.env.GITHUB_OAUTH_CLIENT_ID = "Iv1.client";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    process.env.GITHUB_OAUTH_CALLBACK_URL = "https://api.flagpilot.example/api/v1/github/oauth/callback";
    assert.equal(isGitHubAppConfigured(), true);

    process.env.GITHUB_OAUTH_CALLBACK_URL = "https://api.flagpilot.example.evil.test/api/v1/github/oauth/callback";
    assert.equal(isGitHubAppConfigured(), true); // URL is HTTPS; domain control is delegated to deployment configuration.
    process.env.GITHUB_OAUTH_CALLBACK_URL = "https://api.flagpilot.example/api/v1/github/oauth/callback?next=https://evil.test";
    assert.equal(isGitHubAppConfigured(), false);
    process.env.GITHUB_OAUTH_CALLBACK_URL = "http://api.flagpilot.example/api/v1/github/oauth/callback";
    assert.equal(isGitHubAppConfigured(), false);
    process.env.GITHUB_OAUTH_CALLBACK_URL = "https://api.flagpilot.example/oauth/callback";
    assert.equal(isGitHubAppConfigured(), false);
    process.env.GITHUB_APP_PRIVATE_KEY = "not a private key";
    process.env.GITHUB_OAUTH_CALLBACK_URL = "https://api.flagpilot.example/api/v1/github/oauth/callback";
    assert.equal(isGitHubAppConfigured(), false);
  } finally {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
