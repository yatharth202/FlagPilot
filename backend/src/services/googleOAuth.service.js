import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { ApiError } from "../utils/ApiError.js";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_HTTP_TIMEOUT_MS = 10_000;

let cachedGoogleKeys = null;
let cachedGoogleKeysUntil = 0;

export const GOOGLE_OAUTH_STATE_TTL_MS = STATE_TTL_MS;

export const sha256Base64Url = (value) =>
  createHash("sha256").update(String(value)).digest("base64url");

export const createOAuthRandomValue = (byteLength = 32) =>
  randomBytes(byteLength).toString("base64url");

export const createPkceChallenge = (verifier) => sha256Base64Url(verifier);


export const getGoogleAllowedHostedDomains = (env = process.env) => {
  const raw = String(env.GOOGLE_ALLOWED_HOSTED_DOMAINS || "").trim();
  if (!raw) return [];
  const domains = raw.split(",").map((item) => item.trim().toLowerCase());
  const domainPattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (domains.some((domain) => !domain || !domainPattern.test(domain))) {
    throw new Error("GOOGLE_ALLOWED_HOSTED_DOMAINS must be a comma-separated list of valid Workspace domains, without schemes or paths.");
  }
  if (new Set(domains).size !== domains.length) throw new Error("GOOGLE_ALLOWED_HOSTED_DOMAINS contains duplicate domains.");
  return domains;
};


export const getGoogleHostedDomainHint = (env = process.env) => {
  const domains = getGoogleAllowedHostedDomains(env);
  return domains.length === 1 ? domains[0] : undefined;
};

export const isGoogleOAuthConfigured = (env = process.env) => Boolean(
  env.GOOGLE_CLIENT_ID?.trim() &&
  env.GOOGLE_CLIENT_SECRET?.trim() &&
  env.GOOGLE_OAUTH_CALLBACK_URL?.trim(),
);

export const validateGoogleOAuthConfiguration = (env = process.env) => {
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CALLBACK_URL"];
  const configured = names.filter((name) => Boolean(env[name]?.trim()));
  const allowedDomains = String(env.GOOGLE_ALLOWED_HOSTED_DOMAINS || "").trim();
  if (configured.length === 0 && allowedDomains) {
    throw new Error("GOOGLE_ALLOWED_HOSTED_DOMAINS requires Google OAuth credentials to be configured.");
  }
  if (configured.length === 0) return false;
  if (configured.length !== names.length) {
    throw new Error("Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_OAUTH_CALLBACK_URL together, or leave all three unset.");
  }

  let callback;
  try { callback = new URL(env.GOOGLE_OAUTH_CALLBACK_URL); }
  catch { throw new Error("GOOGLE_OAUTH_CALLBACK_URL must be a valid absolute URL."); }
  if (!(["http:", "https:"].includes(callback.protocol)) || callback.username || callback.password || callback.search || callback.hash) {
    throw new Error("GOOGLE_OAUTH_CALLBACK_URL must be an HTTP(S) callback URL without credentials, query, or fragment.");
  }
  if (env.NODE_ENV === "production" && callback.protocol !== "https:") {
    throw new Error("GOOGLE_OAUTH_CALLBACK_URL must use HTTPS in production.");
  }
  if (env.GOOGLE_CLIENT_ID.length > 300 || env.GOOGLE_CLIENT_SECRET.length > 500) {
    throw new Error("Google OAuth credentials exceed the supported length.");
  }
  getGoogleAllowedHostedDomains(env);
  return true;
};


export const normalizeGoogleReturnTo = (rawValue) => {
  if (typeof rawValue !== "string" || !rawValue || rawValue.length > 2048) return "/dashboard";
  try {
    const base = new URL("https://flagpilot.invalid");
    const parsed = new URL(rawValue, base);
    if (parsed.origin !== base.origin) return "/dashboard";
    if (!["/dashboard", "/invite/accept"].includes(parsed.pathname)) return "/dashboard";

    return parsed.pathname;
  } catch {
    return "/dashboard";
  }
};

export const buildGoogleAuthorizationUrl = ({ clientId, callbackUrl, state, nonce, codeChallenge, hostedDomainHint }) => {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (typeof hostedDomainHint === "string" && hostedDomainHint) url.searchParams.set("hd", hostedDomainHint);
  return url.toString();
};

export const validateGoogleIdTokenClaims = (payload, {
  clientId,
  expectedNonceHash,
  allowedHostedDomains = [],
  nowSeconds = Math.floor(Date.now() / 1000),
}) => {
  if (!payload || typeof payload !== "object") throw new Error("Google ID token payload is invalid.");
  if (!["https://accounts.google.com", "accounts.google.com"].includes(payload.iss)) throw new Error("Google ID token issuer is invalid.");

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) throw new Error("Google ID token audience does not match this application.");
  if (payload.azp && payload.azp !== clientId) throw new Error("Google ID token authorized party does not match this application.");
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) {
    throw new Error("Google ID token is missing a valid authorized party.");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) throw new Error("Google ID token has expired.");
  if (!Number.isFinite(payload.iat) || payload.iat > nowSeconds + 120 || payload.iat < nowSeconds - 24 * 60 * 60) {
    throw new Error("Google ID token issued-at time is invalid.");
  }
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) throw new Error("Google account subject is invalid.");
  if (!(payload.email_verified === true || payload.email_verified === "true")) throw new Error("Google must verify the email address before it can be used to sign in.");
  if (allowedHostedDomains.length > 0) {
    const hostedDomain = typeof payload.hd === "string" ? payload.hd.toLowerCase() : "";
    if (!allowedHostedDomains.includes(hostedDomain)) throw new Error("This Google Workspace account is not in an allowed company domain.");
  }
  if (typeof payload.email !== "string" || payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new Error("Google did not return a valid email address.");
  }
  if (typeof payload.nonce !== "string" || !expectedNonceHash) throw new Error("Google ID token nonce is missing.");
  const actualNonceHash = Buffer.from(sha256Base64Url(payload.nonce));
  const expectedHash = Buffer.from(expectedNonceHash);
  if (actualNonceHash.length !== expectedHash.length || !timingSafeEqual(actualNonceHash, expectedHash)) {
    throw new Error("Google ID token nonce does not match the login request.");
  }

  const name = typeof payload.name === "string" && payload.name.trim()
    ? payload.name.trim().slice(0, 80)
    : payload.email.split("@")[0].slice(0, 80);
  const picture = typeof payload.picture === "string" && payload.picture.length <= 2048 && payload.picture.startsWith("https://")
    ? payload.picture
    : null;

  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name,
    picture,
  };
};

const getGooglePublicKeys = async (fetchImpl, { force = false } = {}) => {
  if (!force && cachedGoogleKeys && Date.now() < cachedGoogleKeysUntil) return cachedGoogleKeys;
  const response = await fetchImpl(GOOGLE_CERTS_ENDPOINT, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Could not retrieve Google's public signing keys.");
  const body = await response.json();
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error("Google returned an invalid public-key set.");
  const cacheControl = response.headers?.get?.("cache-control") || "";
  const maxAge = Number(/max-age=(\d+)/i.exec(cacheControl)?.[1] || 300);
  cachedGoogleKeys = body.keys;
  cachedGoogleKeysUntil = Date.now() + Math.min(Math.max(maxAge, 60), 21_600) * 1000;
  return cachedGoogleKeys;
};

export const verifyGoogleIdToken = async (idToken, {
  clientId,
  expectedNonceHash,
  allowedHostedDomains = [],
  fetchImpl = globalThis.fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
}) => {
  if (typeof idToken !== "string" || idToken.length > 16_384) throw new Error("Google did not return a valid ID token.");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Google ID token format is invalid.");

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Google ID token could not be decoded.");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Google ID token signing algorithm is not accepted.");

  let keys = await getGooglePublicKeys(fetchImpl);
  let jwk = keys.find((key) => key.kid === header.kid && key.alg === "RS256" && key.use === "sig");
  if (!jwk) {
    keys = await getGooglePublicKeys(fetchImpl, { force: true });
    jwk = keys.find((key) => key.kid === header.kid && key.alg === "RS256" && key.use === "sig");
  }
  if (!jwk) throw new Error("Google ID token signing key is unknown.");

  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signedContent = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  if (!verifySignature("RSA-SHA256", signedContent, publicKey, signature)) {
    throw new Error("Google ID token signature is invalid.");
  }

  return validateGoogleIdTokenClaims(payload, { clientId, expectedNonceHash, allowedHostedDomains, nowSeconds });
};

export const exchangeGoogleAuthorizationCode = async ({ code, codeVerifier, env = process.env, fetchImpl = globalThis.fetch }) => {
  const config = {
    clientId: env.GOOGLE_CLIENT_ID?.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET?.trim(),
    callbackUrl: env.GOOGLE_OAUTH_CALLBACK_URL?.trim(),
  };
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MS),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.id_token !== "string") {

    throw new ApiError(401, "Google sign-in could not be completed. Please try again.");
  }
  return result.id_token;
};

export const resetGoogleJwksCacheForTests = () => {
  cachedGoogleKeys = null;
  cachedGoogleKeysUntil = 0;
};
