import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SAFE_DEPLOYMENT_STATES = new Set(["queued", "pending", "in_progress", "success", "failure", "error", "inactive"]);

export const hashGitHubState = (state) => {
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(state)) {
    throw new TypeError("GitHub installation state is invalid");
  }
  return createHash("sha256").update(state, "utf8").digest("hex");
};

export const isValidGitHubWebhookSignature = (rawBody, signature, secret) => {
  if (!Buffer.isBuffer(rawBody) || typeof secret !== "string" || secret.length < 16) return false;
  if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const suppliedBuffer = Buffer.from(signature.toLowerCase());
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
};

export const parseGitHubNumericId = (value, fieldName = "GitHub ID") => {
  const parsed = typeof value === "number" ? value : (typeof value === "string" && /^\d{1,20}$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError(`${fieldName} must be a positive safe integer`);
  return parsed;
};

export const validateGitHubRepositorySelection = (repositoryIds, availableRepositories, { maxItems = 100 } = {}) => {
  if (!Array.isArray(repositoryIds) || repositoryIds.length > maxItems) {
    throw new TypeError(`repositoryIds must be an array containing at most ${maxItems} items`);
  }
  const normalized = repositoryIds.map((id) => parseGitHubNumericId(id, "repositoryId"));
  if (new Set(normalized).size !== normalized.length) throw new TypeError("repositoryIds must not contain duplicates");
  const available = new Map((availableRepositories || []).map((repository) => [Number(repository.id), repository]));
  const unknown = normalized.filter((id) => !available.has(id));
  if (unknown.length) throw new TypeError("One or more repositories are not available to this GitHub App installation");
  return normalized.map((id) => available.get(id));
};

export const normalizeGitHubDeploymentPayload = (payload) => {
  const installationId = parseGitHubNumericId(payload?.installation?.id, "installation.id");
  const repositoryId = parseGitHubNumericId(payload?.repository?.id, "repository.id");
  const deployment = payload?.deployment;
  const status = payload?.deployment_status;
  const deploymentId = parseGitHubNumericId(deployment?.id, "deployment.id");
  const deploymentStatusId = parseGitHubNumericId(status?.id, "deployment_status.id");
  const state = String(status?.state || "").toLowerCase();
  if (!SAFE_DEPLOYMENT_STATES.has(state)) throw new TypeError("Unsupported GitHub deployment state");
  const sha = String(deployment?.sha || "").toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new TypeError("GitHub deployment SHA is invalid");
  const fullName = String(payload?.repository?.full_name || "");
  if (fullName.length > 200 || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)) throw new TypeError("GitHub repository name is invalid");
  if (typeof deployment?.environment !== "string") throw new TypeError("GitHub deployment environment is invalid");
  const environment = deployment.environment.trim();
  if (!environment || environment.length > 100) throw new TypeError("GitHub deployment environment is invalid");

  const safeUrl = (value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || value.length > 1000) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
    } catch { return null; }
  };
  const deployedAtRaw = status?.updated_at || status?.created_at || deployment?.created_at;
  const deployedAt = new Date(deployedAtRaw);
  if (!deployedAtRaw || Number.isNaN(deployedAt.getTime())) throw new TypeError("GitHub deployment timestamp is invalid");

  return {
    installationId,
    repositoryId,
    repositoryFullName: fullName,
    deploymentId: String(deploymentId),
    deploymentStatusId: String(deploymentStatusId),
    state,
    environment,
    sha,
    ref: typeof deployment.ref === "string" ? deployment.ref.slice(0, 255) : null,
    description: typeof status.description === "string" ? status.description.slice(0, 500) : null,
    environmentUrl: safeUrl(status.environment_url),
    logUrl: safeUrl(status.log_url),
    creatorLogin: typeof status.creator?.login === "string" ? status.creator.login.slice(0, 100) : null,
    deployedAt,
  };
};

export const buildGitHubInstallUrl = ({ appSlug, state }) => {
  if (typeof appSlug !== "string" || !/^[a-z0-9-]{1,100}$/i.test(appSlug)) throw new TypeError("GITHUB_APP_SLUG is invalid");
  hashGitHubState(state);
  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
};



export const buildGitHubInstallationTransition = ({ action, previousSuspendedAt = null, previousDisconnectedAt = null, now = new Date() } = {}) => {
  if (!['deleted', 'suspend', 'unsuspend'].includes(action)) {
    throw new TypeError('Unsupported GitHub installation lifecycle action');
  }
  const transitionTime = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(transitionTime.getTime())) throw new TypeError('GitHub installation transition time is invalid');
  const nextSuspendedAt = action === 'deleted' || action === 'suspend' ? transitionTime : null;
  const nextDisconnectedAt = action === 'deleted' ? transitionTime : previousDisconnectedAt || null;
  return {
    before: {
      suspendedAt: previousSuspendedAt || null,
      disconnectedAt: previousDisconnectedAt || null,
    },
    after: {
      suspendedAt: nextSuspendedAt,
      disconnectedAt: nextDisconnectedAt,
    },
  };
};

export const isGitHubInstallationAccessibleToUser = (accessibleInstallations, installationId, expectedAccountId) => {
  const expectedInstallationId = Number(installationId);
  const expectedOwnerId = Number(expectedAccountId);
  if (!Number.isSafeInteger(expectedInstallationId) || expectedInstallationId <= 0 || !Number.isSafeInteger(expectedOwnerId) || expectedOwnerId <= 0) return false;
  const installation = (accessibleInstallations || []).find((item) => Number(item?.id) === expectedInstallationId);
  return Boolean(installation && Number(installation.account?.id) === expectedOwnerId);
};
