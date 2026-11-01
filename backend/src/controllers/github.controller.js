import { randomBytes } from "node:crypto";
import { Project } from "../models/project.model.js";
import { User } from "../models/user.model.js";
import { GitHubInstallState } from "../models/githubInstallState.model.js";
import { GitHubInstallation } from "../models/githubInstallation.model.js";
import { GitHubProjectInstallation } from "../models/githubProjectInstallation.model.js";
import { GitHubRepositoryLink } from "../models/githubRepositoryLink.model.js";
import { GitHubDeployment } from "../models/githubDeployment.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { resolveProjectRole } from "../utils/projectRole.js";
import { buildGitHubInstallUrl, hashGitHubState, parseGitHubNumericId, validateGitHubRepositorySelection, isGitHubInstallationAccessibleToUser } from "../utils/githubPolicy.js";
import {
  getGitHubInstallation, isGitHubAppConfigured, listGitHubInstallationRepositories,
  buildGitHubOAuthAuthorizationUrl, exchangeGitHubOAuthCode, getGitHubAuthenticatedUser, listGitHubUserInstallations,
} from "../services/githubApp.service.js";
import { withMongoTransaction, inSession, createInSession } from "../utils/withMongoTransaction.js";
import { createAuditLogInSession } from "../utils/auditLog.js";
import { parseFrontendOrigins } from "../utils/deploymentPolicy.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const assertGitHubConfigured = () => {
  if (!isGitHubAppConfigured()) {
    throw new ApiError(503, "GitHub App integration is not configured. Set the App ID, slug, valid RSA private key, webhook secret, OAuth client credentials, and HTTPS OAuth callback URL.");
  }
};

const parseInstallationRouteId = (value) => {
  try { return parseGitHubNumericId(value, "installationId"); }
  catch { throw new ApiError(400, "installationId must be a positive numeric GitHub installation ID"); }
};

const serializeInstallation = (link, installation) => ({
  installationId: link.installationId,
  accountLogin: installation?.accountLogin || "Unknown account",
  accountType: installation?.accountType || "Unknown",
  connectedAt: link.connectedAt,
  disconnectedAt: link.disconnectedAt,
  suspendedAt: installation?.suspendedAt || null,
});


export const getGitHubOverview = asyncHandler(async (req, res) => {
  const [links, repositories, deployments] = await Promise.all([
    GitHubProjectInstallation.find({ projectId: req.project._id }).sort({ createdAt: -1 }).lean(),
    GitHubRepositoryLink.find({ projectId: req.project._id, active: true }).sort({ fullName: 1 }).lean(),
    GitHubDeployment.find({ projectId: req.project._id }).sort({ deployedAt: -1, _id: -1 }).limit(50).lean(),
  ]);
  const installations = await GitHubInstallation.find({ installationId: { $in: links.map((item) => item.installationId) } }).lean();
  const installationById = new Map(installations.map((item) => [item.installationId, item]));
  return res.status(200).json(new ApiResponse(200, {
    configured: isGitHubAppConfigured(),
    installations: links.map((link) => serializeInstallation(link, installationById.get(link.installationId))),
    repositories: repositories.map((item) => ({
      id: String(item._id), repositoryId: item.repositoryId, installationId: item.installationId,
      fullName: item.fullName, htmlUrl: item.htmlUrl, ownerLogin: item.ownerLogin,
      defaultBranch: item.defaultBranch, isPrivate: item.isPrivate, linkedAt: item.linkedAt,
    })),
    deployments: deployments.map((item) => ({
      id: String(item._id), repositoryFullName: item.repositoryFullName, state: item.state,
      environment: item.environment, sha: item.sha, ref: item.ref,
      description: item.description, environmentUrl: item.environmentUrl, logUrl: item.logUrl,
      creatorLogin: item.creatorLogin, deployedAt: item.deployedAt,
    })),
  }, "GitHub integration status loaded"));
});


export const startGitHubInstallation = asyncHandler(async (req, res) => {
  assertGitHubConfigured();
  const state = randomBytes(32).toString("base64url");
  await GitHubInstallState.create({
    stateHash: hashGitHubState(state),
    projectId: req.project._id,
    userId: req.user._id,
    flowStep: "install",
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  const installationUrl = buildGitHubInstallUrl({ appSlug: process.env.GITHUB_APP_SLUG, state });
  return res.status(200).json(new ApiResponse(200, { installationUrl, expiresInSeconds: STATE_TTL_MS / 1000 }, "GitHub installation started"));
});

const githubRedirect = (res, status, reason = null) => {
  let origin = "http://localhost:5173";
  try { origin = parseFrontendOrigins(process.env.FRONTEND_ORIGIN, { production: process.env.NODE_ENV === "production" })[0]; }
  catch { /* Use a static local fallback only for callback error handling. */ }
  const url = new URL("/integrations", origin);
  url.searchParams.set("github", status);
  if (reason) url.searchParams.set("reason", reason);
  return res.redirect(303, url.toString());
};


export const completeGitHubInstallation = asyncHandler(async (req, res) => {
  try {
    assertGitHubConfigured();
    const state = String(req.query?.state || "");
    const installationId = parseGitHubNumericId(req.query?.installation_id, "installation_id");
    const setupAction = String(req.query?.setup_action || "");
    if (!state || !["install", "update"].includes(setupAction)) throw new ApiError(400, "Invalid GitHub installation callback");

    const stateRecord = await GitHubInstallState.findOneAndUpdate({
      stateHash: hashGitHubState(state), flowStep: "install",
      expiresAt: { $gt: new Date() }, consumedAt: null,
    }, { $set: { consumedAt: new Date() } }, { new: true }).select("projectId userId");
    if (!stateRecord) throw new ApiError(400, "GitHub installation state is invalid, expired, or already used. Start again from FlagPilot.");

    const [project, user] = await Promise.all([
      Project.findOne({ _id: stateRecord.projectId, archivedAt: null, $or: [{ ownerId: stateRecord.userId }, { "members.userId": stateRecord.userId }] }),
      User.findById(stateRecord.userId).select("_id"),
    ]);
    const role = resolveProjectRole(project, stateRecord.userId);
    if (!project || !user || !["owner", "admin"].includes(role)) throw new ApiError(403, "The initiating user no longer has permission to connect GitHub to this project");
    const installation = await getGitHubInstallation(installationId);
    if (Number(installation?.id) !== installationId || !installation?.account?.login || !Number.isSafeInteger(Number(installation.account.id)) || Number(installation.account.id) <= 0) {
      throw new ApiError(502, "GitHub returned invalid installation metadata");
    }
    if (installation.suspended_at) throw new ApiError(409, "This GitHub App installation is suspended");
    if (!installation.permissions?.deployments || !["read", "write"].includes(installation.permissions.deployments)) {
      throw new ApiError(409, "Reconfigure the GitHub App with Deployments: read permission, then retry the installation");
    }


    const oauthState = randomBytes(32).toString("base64url");
    await GitHubInstallState.create({
      stateHash: hashGitHubState(oauthState), projectId: project._id, userId: user._id,
      flowStep: "oauth", installationId, expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    const authorizationUrl = buildGitHubOAuthAuthorizationUrl({
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      redirectUri: process.env.GITHUB_OAUTH_CALLBACK_URL,
      state: oauthState,
    });
    return res.redirect(303, authorizationUrl);
  } catch (error) {
    const reason = error instanceof ApiError && error.statusCode === 403 ? "permission" : "callback_failed";
    return githubRedirect(res, "error", reason);
  }
});


export const completeGitHubOAuth = asyncHandler(async (req, res) => {
  try {
    assertGitHubConfigured();
    if (req.query?.error) throw new ApiError(400, "GitHub user authorization was cancelled");
    const code = String(req.query?.code || "");
    const state = String(req.query?.state || "");
    const stateRecord = await GitHubInstallState.findOneAndUpdate({
      stateHash: hashGitHubState(state), flowStep: "oauth",
      expiresAt: { $gt: new Date() }, consumedAt: null,
    }, { $set: { consumedAt: new Date() } }, { new: true }).select("projectId userId installationId");
    if (!stateRecord) throw new ApiError(400, "GitHub authorization state is invalid, expired, or already used");

    const [project, user] = await Promise.all([
      Project.findOne({ _id: stateRecord.projectId, archivedAt: null, $or: [{ ownerId: stateRecord.userId }, { "members.userId": stateRecord.userId }] }),
      User.findById(stateRecord.userId).select("_id"),
    ]);
    const role = resolveProjectRole(project, stateRecord.userId);
    if (!project || !user || !["owner", "admin"].includes(role)) throw new ApiError(403, "The initiating user no longer has permission to connect GitHub to this project");

 
    const userToken = await exchangeGitHubOAuthCode(code);
    const [githubUser, accessibleInstallations, installation] = await Promise.all([
      getGitHubAuthenticatedUser(userToken),
      listGitHubUserInstallations(userToken),
      getGitHubInstallation(stateRecord.installationId),
    ]);
    if (!githubUser?.id || !isGitHubInstallationAccessibleToUser(accessibleInstallations, stateRecord.installationId, installation?.account?.id)) {
      throw new ApiError(403, "The GitHub account you authorized cannot access this GitHub App installation");
    }
    if (installation.suspended_at || !installation.permissions?.deployments || !["read", "write"].includes(installation.permissions.deployments)) {
      throw new ApiError(409, "The GitHub App must be active and have Deployments: read permission");
    }

    await withMongoTransaction(async (session) => {
      const installationRecord = await inSession(GitHubInstallation.findOneAndUpdate(
        { installationId: stateRecord.installationId },
        { $set: {
          accountId: Number(installation.account.id),
          accountLogin: String(installation.account.login).slice(0, 100),
          accountType: ["User", "Organization", "Bot"].includes(installation.account.type) ? installation.account.type : "User",
          targetType: installation.target_type === "Organization" ? "organization" : "user",
          suspendedAt: null, lastSyncedAt: new Date(),
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ), session);
      const existingLink = await inSession(GitHubProjectInstallation.findOne({ projectId: project._id, installationId: stateRecord.installationId }), session);
      const before = existingLink ? { disconnectedAt: existingLink.disconnectedAt } : null;
      const connection = existingLink || await createInSession(GitHubProjectInstallation, {
        projectId: project._id, installationId: stateRecord.installationId, connectedBy: user._id,
      }, session);
      if (existingLink) {
        existingLink.disconnectedAt = null;
        existingLink.connectedAt = new Date();
        await existingLink.save(session ? { session } : undefined);
      }
      await createAuditLogInSession({
        projectId: project._id, entityType: "github_installation", entityId: connection._id, flagId: null,
        action: "GITHUB_INSTALLATION_CONNECTED", changedBy: user._id, actorId: user._id,
        actorRole: role, requestId: req.id, before,
        after: { installationId: stateRecord.installationId, accountLogin: installationRecord.accountLogin, accountType: installationRecord.accountType, githubUserId: Number(githubUser.id) },
      }, session);
    });
    return githubRedirect(res, "connected");
  } catch (error) {
    const reason = error instanceof ApiError && error.statusCode === 403 ? "permission" : "callback_failed";
    return githubRedirect(res, "error", reason);
  }
});

const assertConnectedInstallation = async (projectId, installationId) => {
  const connection = await GitHubProjectInstallation.findOne({ projectId, installationId, disconnectedAt: null });
  if (!connection) throw new ApiError(404, "GitHub App installation is not connected to this project");
  const installation = await GitHubInstallation.findOne({ installationId, suspendedAt: null }).select("installationId");
  if (!installation) throw new ApiError(409, "The GitHub App installation is suspended or unavailable");
  return connection;
};


export const listGitHubInstallationRepositoriesForProject = asyncHandler(async (req, res) => {
  assertGitHubConfigured();
  const installationId = parseInstallationRouteId(req.params.installationId);
  await assertConnectedInstallation(req.project._id, installationId);
  let repositories;
  try { repositories = await listGitHubInstallationRepositories(installationId); }
  catch (error) { throw new ApiError(error.status === 404 ? 404 : 502, "Could not retrieve repositories from GitHub. Check the App installation and permissions."); }
  const linked = await GitHubRepositoryLink.find({ projectId: req.project._id, installationId, active: true }).select("repositoryId").lean();
  const linkedIds = new Set(linked.map((item) => Number(item.repositoryId)));
  return res.status(200).json(new ApiResponse(200, repositories.map((repository) => ({
    id: parseGitHubNumericId(repository.id, "repository.id"),
    fullName: String(repository.full_name || "").slice(0, 200),
    htmlUrl: String(repository.html_url || "").slice(0, 500),
    ownerLogin: String(repository.owner?.login || "").slice(0, 100),
    defaultBranch: String(repository.default_branch || "main").slice(0, 255),
    isPrivate: Boolean(repository.private),
    linked: linkedIds.has(Number(repository.id)),
  })), "GitHub repositories loaded"));
});


export const syncGitHubRepositories = asyncHandler(async (req, res) => {
  assertGitHubConfigured();
  const installationId = parseInstallationRouteId(req.params.installationId);
  await assertConnectedInstallation(req.project._id, installationId);
  let available;
  try { available = await listGitHubInstallationRepositories(installationId); }
  catch { throw new ApiError(502, "Could not verify repositories against GitHub. No FlagPilot changes were made."); }
  let selected;
  try { selected = validateGitHubRepositorySelection(req.body?.repositoryIds, available); }
  catch (error) { throw new ApiError(400, error.message); }

  const changes = await withMongoTransaction(async (session) => {
    const existing = await inSession(GitHubRepositoryLink.find({ projectId: req.project._id, installationId }), session);
    const selectedIds = new Set(selected.map((item) => Number(item.id)));
    let linkedCount = 0;
    let unlinkedCount = 0;

    for (const link of existing) {
      if (link.active && !selectedIds.has(Number(link.repositoryId))) {
        link.active = false;
        link.unlinkedAt = new Date();
        await link.save(session ? { session } : undefined);
        await createAuditLogInSession({
          projectId: req.project._id, entityType: "github_repository", entityId: link._id, flagId: null,
          action: "GITHUB_REPOSITORY_UNLINKED", changedBy: req.user._id, actorId: req.user._id,
          actorRole: req.projectRole, requestId: req.id,
          before: { fullName: link.fullName, active: true }, after: { fullName: link.fullName, active: false },
        }, session);
        unlinkedCount += 1;
      }
    }

    for (const repository of selected) {
      const repositoryId = Number(repository.id);
      const current = await inSession(GitHubRepositoryLink.findOne({ projectId: req.project._id, repositoryId }), session);
      if (current?.active && Number(current.installationId) !== installationId) {
        throw new ApiError(409, `${repository.full_name} is already linked through another GitHub installation`);
      }
      if (current?.active) continue;
      const data = {
        installationId, repositoryId,
        fullName: String(repository.full_name).slice(0, 200),
        htmlUrl: String(repository.html_url).slice(0, 500),
        ownerLogin: String(repository.owner?.login || "").slice(0, 100),
        defaultBranch: String(repository.default_branch || "main").slice(0, 255),
        isPrivate: Boolean(repository.private), active: true, linkedBy: req.user._id,
        linkedAt: new Date(), unlinkedAt: null,
      };
      const before = current ? {
        active: current.active,
        fullName: current.fullName,
        installationId: current.installationId,
      } : null;
      let link;
      if (current) {
        Object.assign(current, data);
        link = await current.save(session ? { session } : undefined);
      } else {
        link = await createInSession(GitHubRepositoryLink, { projectId: req.project._id, ...data }, session);
      }
      await createAuditLogInSession({
        projectId: req.project._id, entityType: "github_repository", entityId: link._id, flagId: null,
        action: "GITHUB_REPOSITORY_LINKED", changedBy: req.user._id, actorId: req.user._id,
        actorRole: req.projectRole, requestId: req.id,
        before,
        after: { repositoryId, fullName: link.fullName, installationId, isPrivate: link.isPrivate },
      }, session);
      linkedCount += 1;
    }
    return { linkedCount, unlinkedCount, selectedCount: selected.length };
  });

  return res.status(200).json(new ApiResponse(200, changes, "GitHub repository selection saved"));
});

/** Disconnect an installation from this FlagPilot project without uninstalling it from GitHub. */
export const disconnectGitHubInstallation = asyncHandler(async (req, res) => {
  const installationId = parseInstallationRouteId(req.params.installationId);
  const result = await withMongoTransaction(async (session) => {
    const connection = await inSession(GitHubProjectInstallation.findOne({ projectId: req.project._id, installationId, disconnectedAt: null }), session);
    if (!connection) throw new ApiError(404, "GitHub App installation is not connected to this project");
    const before = { disconnectedAt: connection.disconnectedAt };
    connection.disconnectedAt = new Date();
    await connection.save(session ? { session } : undefined);
    const update = await inSession(GitHubRepositoryLink.updateMany(
      { projectId: req.project._id, installationId, active: true },
      { $set: { active: false, unlinkedAt: new Date() } },
    ), session);
    await createAuditLogInSession({
      projectId: req.project._id, entityType: "github_installation", entityId: connection._id, flagId: null,
      action: "GITHUB_INSTALLATION_DISCONNECTED", changedBy: req.user._id, actorId: req.user._id,
      actorRole: req.projectRole, requestId: req.id, before,
      after: { installationId, disconnectedAt: connection.disconnectedAt, disabledRepositoryCount: update.modifiedCount },
    }, session);
    return { disabledRepositoryCount: update.modifiedCount };
  });
  return res.status(200).json(new ApiResponse(200, result, "GitHub installation disconnected from this project"));
});

