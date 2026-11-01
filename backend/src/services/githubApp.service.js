import { createPrivateKey, createSign } from "node:crypto";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

export const buildGitHubAppJwt = ({ appId, privateKey, now = Date.now() }) => {
  const normalizedAppId = String(appId || "").trim();
  const keyText = String(privateKey || "").replace(/\\n/g, "\n").trim();
  if (!/^\d{1,20}$/.test(normalizedAppId)) throw new TypeError("GITHUB_APP_ID must be a positive numeric app ID");
  if (!keyText.includes("BEGIN RSA PRIVATE KEY") && !keyText.includes("BEGIN PRIVATE KEY")) {
    throw new TypeError("GITHUB_APP_PRIVATE_KEY must contain a PEM private key");
  }
  const issuedAt = Math.floor(now / 1000) - 60;
  const header = base64urlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64urlJson({ iat: issuedAt, exp: issuedAt + 600, iss: normalizedAppId });
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(keyText).toString("base64url");
  return `${signingInput}.${signature}`;
};

export const isGitHubAppConfigured = () => {
  const callback = String(process.env.GITHUB_OAUTH_CALLBACK_URL || "").trim();
  let callbackIsValid = false;
  let privateKeyIsValid = false;
  try {
    const parsed = new URL(callback);
    callbackIsValid = parsed.protocol === "https:" && Boolean(parsed.hostname)
      && !parsed.username && !parsed.password && !parsed.hash && !parsed.search
      && parsed.pathname === "/api/v1/github/oauth/callback";
  } catch { /* Invalid callback URLs keep the integration disabled. */ }
  try {
    const privateKey = String(process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
    privateKeyIsValid = createPrivateKey(privateKey).asymmetricKeyType === "rsa";
  } catch {  }

  return Boolean(
    /^\d{1,20}$/.test(String(process.env.GITHUB_APP_ID || ""))
    && Number(process.env.GITHUB_APP_ID) > 0
    && Number.isSafeInteger(Number(process.env.GITHUB_APP_ID))
    && /^[a-z0-9-]{1,100}$/i.test(String(process.env.GITHUB_APP_SLUG || ""))
    && privateKeyIsValid
    && String(process.env.GITHUB_WEBHOOK_SECRET || "").trim().length >= 32
    && String(process.env.GITHUB_OAUTH_CLIENT_ID || "").trim().length > 0
    && String(process.env.GITHUB_OAUTH_CLIENT_SECRET || "").trim().length > 0
    && callbackIsValid,
  );
};

const appJwt = () => buildGitHubAppJwt({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
});

const requestGitHub = async (path, { method = "GET", token, body } = {}) => {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "FlagPilot-GitHub-App",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* GitHub can return an empty response body. */ }
  if (!response.ok) {
    const error = new Error(`GitHub API request failed with status ${response.status}`);
    error.status = response.status;
    error.githubRequestId = response.headers.get("x-github-request-id") || null;
    throw error;
  }
  return payload;
};

export const getGitHubInstallation = async (installationId) => requestGitHub(
  `/app/installations/${installationId}`,
  { token: appJwt() },
);

export const createGitHubInstallationToken = async (installationId) => {
  const result = await requestGitHub(`/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    token: appJwt(),
  });
  const expiresAt = new Date(result?.expires_at);
  if (typeof result?.token !== "string" || !result.token || !result.expires_at || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new Error("GitHub did not return a valid installation access token");
  }

  return { token: result.token, expiresAt };
};


export const buildGitHubOAuthAuthorizationUrl = ({ clientId, redirectUri, state }) => {
  if (typeof clientId !== "string" || !clientId.trim()) throw new TypeError("GITHUB_OAUTH_CLIENT_ID is required");
  if (typeof redirectUri !== "string" || !/^https:\/\//i.test(redirectUri)) throw new TypeError("GITHUB_OAUTH_CALLBACK_URL must use HTTPS");
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(state)) throw new TypeError("GitHub OAuth state is invalid");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
};

const requestGitHubOAuthToken = async ({ method = "POST", body }) => {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "FlagPilot-GitHub-App" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok || typeof payload?.access_token !== "string") {
    const error = new Error("GitHub user authorization could not be completed");
    error.status = response.status;
    throw error;
  }
  return payload.access_token;
};

export const exchangeGitHubOAuthCode = async (code) => {
  if (typeof code !== "string" || !/^[A-Za-z0-9._-]{10,200}$/.test(code)) throw new TypeError("GitHub OAuth code is invalid");
  return requestGitHubOAuthToken({ body: {
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
    client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
    code,
    redirect_uri: process.env.GITHUB_OAUTH_CALLBACK_URL,
  } });
};

export const getGitHubAuthenticatedUser = async (userAccessToken) => requestGitHub("/user", { token: userAccessToken });

export const listGitHubUserInstallations = async (userAccessToken) => {
  const installations = [];
  let totalCount = null;
  const maxPages = 20;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await requestGitHub(`/user/installations?per_page=100&page=${page}`, { token: userAccessToken });
    if (!Array.isArray(result?.installations)) throw new Error("GitHub returned an invalid user installation list");
    if (totalCount === null) {
      totalCount = Number(result.total_count);
      if (!Number.isSafeInteger(totalCount) || totalCount < 0) throw new Error("GitHub returned an invalid user installation total");
    }
    installations.push(...result.installations);
    if (installations.length >= totalCount || result.installations.length < 100) break;
  }
  if (totalCount !== null && installations.length < totalCount) throw new Error("GitHub user has more than 2,000 App installations; contact support");
  return installations;
};

export const listGitHubInstallationRepositories = async (installationId) => {
  const { token } = await createGitHubInstallationToken(installationId);
  const repositories = [];
  let totalCount = null;
  const maxPages = 20;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await requestGitHub(`/installation/repositories?per_page=100&page=${page}`, { token });
    if (!Array.isArray(result?.repositories)) throw new Error("GitHub returned an invalid repository list");
    if (totalCount === null) {
      totalCount = Number(result.total_count);
      if (!Number.isSafeInteger(totalCount) || totalCount < 0) throw new Error("GitHub returned an invalid repository total");
    }
    repositories.push(...result.repositories);
    if (repositories.length >= totalCount || result.repositories.length < 100) break;
  }
  if (totalCount !== null && repositories.length < totalCount) {
    throw new Error("GitHub installation has more than 2,000 repositories; narrow the installation scope before linking repositories");
  }
  return repositories;
};
