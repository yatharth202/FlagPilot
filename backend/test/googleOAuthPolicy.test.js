import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signJwt } from "node:crypto";
import {
  buildGoogleAuthorizationUrl,
  createPkceChallenge,
  exchangeGoogleAuthorizationCode,
  getGoogleAllowedHostedDomains,
  getGoogleHostedDomainHint,
  normalizeGoogleReturnTo,
  resetGoogleJwksCacheForTests,
  sha256Base64Url,
  validateGoogleIdTokenClaims,
  validateGoogleOAuthConfiguration,
  verifyGoogleIdToken,
} from "../src/services/googleOAuth.service.js";

const clientId = "flagpilot-test.apps.googleusercontent.com";
const nonce = "test-nonce-value-12345678901234567890";
const expectedNonceHash = sha256Base64Url(nonce);
const validClaims = (overrides = {}) => ({
  iss: "https://accounts.google.com",
  aud: clientId,
  sub: "google-subject-123456789",
  email: "Company.User@example.com",
  email_verified: true,
  name: "Company User",
  picture: "https://example.com/avatar.png",
  nonce,
  iat: 1_800_000_000,
  exp: 1_800_003_600,
  ...overrides,
});

const nowSeconds = 1_800_000_100;

test("Google OAuth configuration is optional locally but must be complete when enabled", () => {
  assert.equal(validateGoogleOAuthConfiguration({ NODE_ENV: "development" }), false);
  assert.throws(() => validateGoogleOAuthConfiguration({
    NODE_ENV: "development",
    GOOGLE_ALLOWED_HOSTED_DOMAINS: "company.com",
  }), /requires Google OAuth credentials/);
  assert.throws(() => validateGoogleOAuthConfiguration({
    NODE_ENV: "development",
    GOOGLE_CLIENT_ID: clientId,
  }), /Configure GOOGLE_CLIENT_ID/);
  assert.equal(validateGoogleOAuthConfiguration({
    NODE_ENV: "development",
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_OAUTH_CALLBACK_URL: "http://localhost:8000/api/v1/auth/google/callback",
    GOOGLE_ALLOWED_HOSTED_DOMAINS: "company.com, subsidiary.example",
  }), true);
  assert.deepEqual(getGoogleAllowedHostedDomains({ GOOGLE_ALLOWED_HOSTED_DOMAINS: "Company.com, subsidiary.example" }), ["company.com", "subsidiary.example"]);
  assert.equal(getGoogleHostedDomainHint({ GOOGLE_ALLOWED_HOSTED_DOMAINS: "company.com" }), "company.com");
  assert.equal(getGoogleHostedDomainHint({ GOOGLE_ALLOWED_HOSTED_DOMAINS: "company.com, subsidiary.example" }), undefined);
  assert.throws(() => getGoogleAllowedHostedDomains({ GOOGLE_ALLOWED_HOSTED_DOMAINS: "https://company.com" }), /valid Workspace domains/);
  assert.throws(() => validateGoogleOAuthConfiguration({
    NODE_ENV: "production",
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_OAUTH_CALLBACK_URL: "http://api.example.com/api/v1/auth/google/callback",
  }), /must use HTTPS/);
});

test("Google OAuth return path allows only known local routes", () => {
  assert.equal(normalizeGoogleReturnTo("/dashboard"), "/dashboard");
  assert.equal(normalizeGoogleReturnTo("/invite/accept"), "/invite/accept");
  assert.equal(normalizeGoogleReturnTo("https://attacker.example/steal"), "/dashboard");
  assert.equal(normalizeGoogleReturnTo("//attacker.example/path"), "/dashboard");
  assert.equal(normalizeGoogleReturnTo("/admin"), "/dashboard");
});

test("authorization URL uses state, nonce, OIDC scopes, and S256 PKCE", () => {
  const challenge = createPkceChallenge("high-entropy-verifier-value");
  const url = new URL(buildGoogleAuthorizationUrl({
    clientId,
    callbackUrl: "http://localhost:8000/api/v1/auth/google/callback",
    state: "state-value",
    nonce,
    codeChallenge: challenge,
  }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("nonce"), nonce);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), challenge);
});

test("Google ID token claims validate email, issuer, audience, timestamps and nonce", () => {
  const profile = validateGoogleIdTokenClaims(validClaims(), { clientId, expectedNonceHash, nowSeconds });
  assert.deepEqual(profile, {
    googleId: "google-subject-123456789",
    email: "company.user@example.com",
    name: "Company User",
    picture: "https://example.com/avatar.png",
  });

  assert.throws(() => validateGoogleIdTokenClaims(validClaims({ iss: "https://evil.example" }), { clientId, expectedNonceHash, nowSeconds }), /issuer/);
  assert.throws(() => validateGoogleIdTokenClaims(validClaims({ aud: "another-client" }), { clientId, expectedNonceHash, nowSeconds }), /audience/);
  assert.throws(() => validateGoogleIdTokenClaims(validClaims({ exp: nowSeconds }), { clientId, expectedNonceHash, nowSeconds }), /expired/);
  assert.throws(() => validateGoogleIdTokenClaims(validClaims({ email_verified: false }), { clientId, expectedNonceHash, nowSeconds }), /verify the email/);
  assert.throws(() => validateGoogleIdTokenClaims(validClaims({ nonce: "wrong-nonce" }), { clientId, expectedNonceHash, nowSeconds }), /nonce/);
  assert.throws(() => validateGoogleIdTokenClaims(validClaims({ hd: "other.com" }), { clientId, expectedNonceHash, allowedHostedDomains: ["company.com"], nowSeconds }), /allowed company domain/);
  assert.doesNotThrow(() => validateGoogleIdTokenClaims(validClaims({ hd: "company.com" }), { clientId, expectedNonceHash, allowedHostedDomains: ["company.com"], nowSeconds }));
});

test("Google ID token signature is verified against the provider JWKS", async () => {
  resetGoogleJwksCacheForTests();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const exported = publicKey.export({ format: "jwk" });
  const jwk = { ...exported, kid: "test-key-id", alg: "RS256", use: "sig" };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key-id" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(validClaims())).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = signJwt("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  const token = `${signingInput}.${signature}`;
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({ keys: [jwk] }),
  });

  const profile = await verifyGoogleIdToken(token, { clientId, expectedNonceHash, fetchImpl, nowSeconds });
  assert.equal(profile.email, "company.user@example.com");
  await assert.rejects(
    verifyGoogleIdToken(`${header}.${payload}.${Buffer.from("bad-signature").toString("base64url")}`, {
      clientId, expectedNonceHash, fetchImpl, nowSeconds,
    }),
    /signature is invalid/,
  );
  resetGoogleJwksCacheForTests();
});


import {
  clearGoogleOAuthStateCookie,
  getGoogleOAuthStateCookieOptions,
  googleOAuthStateMatches,
  readGoogleOAuthStateCookie,
  setGoogleOAuthStateCookie,
} from "../src/utils/googleOAuthStateCookie.js";

test("Google OAuth browser-state cookie is HttpOnly, short-lived, and SameSite=Lax", () => {
  const options = getGoogleOAuthStateCookieOptions({ NODE_ENV: "production" });
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/api/v1/auth/google");
  assert.equal(options.maxAge, 10 * 60 * 1000);
});

test("Google OAuth callback state must match the browser cookie and duplicates fail closed", () => {
  const state = "abcdefghijklmnopqrstuvwxzy0123456789_-ABCDEF";
  assert.equal(readGoogleOAuthStateCookie(`other=x; fp_google_oauth_state=${state}`), state);
  assert.equal(googleOAuthStateMatches(state, state), true);
  assert.equal(googleOAuthStateMatches(state, `${state}x`), false);
  assert.equal(readGoogleOAuthStateCookie(`fp_google_oauth_state=${state}; fp_google_oauth_state=${state}`), null);
  assert.equal(readGoogleOAuthStateCookie("fp_google_oauth_state=bad%0Avalue"), null);
});

test("Google OAuth state-cookie setters use the expected cookie name", () => {
  const calls = [];
  const response = {
    cookie: (...args) => calls.push(["set", ...args]),
    clearCookie: (...args) => calls.push(["clear", ...args]),
  };
  const state = "abcdefghijklmnopqrstuvwxzy0123456789_-ABCDEF";
  setGoogleOAuthStateCookie(response, state, { NODE_ENV: "development" });
  clearGoogleOAuthStateCookie(response, { NODE_ENV: "development" });
  assert.equal(calls[0][1], "fp_google_oauth_state");
  assert.equal(calls[0][2], state);
  assert.equal(calls[1][1], "fp_google_oauth_state");
});


test("authorization-code exchange sends the PKCE verifier and exact registered callback", async () => {
  let captured;
  const idToken = "header.payload.signature";
  const result = await exchangeGoogleAuthorizationCode({
    code: "single-use-code",
    codeVerifier: "high-entropy-code-verifier",
    env: {
      GOOGLE_CLIENT_ID: ` ${clientId} `,
      GOOGLE_CLIENT_SECRET: " test-secret ",
      GOOGLE_OAUTH_CALLBACK_URL: " http://localhost:8000/api/v1/auth/google/callback ",
    },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ id_token: idToken }) };
    },
  });

  assert.equal(result, idToken);
  assert.equal(captured.url, "https://oauth2.googleapis.com/token");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.signal instanceof AbortSignal, true);
  const form = new URLSearchParams(captured.options.body);
  assert.equal(form.get("code"), "single-use-code");
  assert.equal(form.get("code_verifier"), "high-entropy-code-verifier");
  assert.equal(form.get("client_id"), clientId);
  assert.equal(form.get("client_secret"), "test-secret");
  assert.equal(form.get("redirect_uri"), "http://localhost:8000/api/v1/auth/google/callback");
  assert.equal(form.get("grant_type"), "authorization_code");
});

test("authorization-code exchange rejects provider errors without exposing response details", async () => {
  await assert.rejects(
    exchangeGoogleAuthorizationCode({
      code: "bad-code",
      codeVerifier: "high-entropy-code-verifier",
      env: {
        GOOGLE_CLIENT_ID: clientId,
        GOOGLE_CLIENT_SECRET: "test-secret",
        GOOGLE_OAUTH_CALLBACK_URL: "http://localhost:8000/api/v1/auth/google/callback",
      },
      fetchImpl: async () => ({ ok: false, json: async () => ({ error: "invalid_grant", error_description: "sensitive provider detail" }) }),
    }),
    (error) => error.statusCode === 401 && !error.message.includes("sensitive provider detail"),
  );
});
