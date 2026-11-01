import { GitHubProjectInstallation } from "../models/githubProjectInstallation.model.js";
import { GitHubInstallation } from "../models/githubInstallation.model.js";
import { GitHubRepositoryLink } from "../models/githubRepositoryLink.model.js";
import { GitHubDeployment } from "../models/githubDeployment.model.js";
import { GitHubWebhookDelivery } from "../models/githubWebhookDelivery.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  buildGitHubInstallationTransition, isValidGitHubWebhookSignature,
  normalizeGitHubDeploymentPayload, parseGitHubNumericId,
} from "../utils/githubPolicy.js";
import { withMongoTransaction, inSession, createInSession } from "../utils/withMongoTransaction.js";
import { createAuditLogInSession } from "../utils/auditLog.js";

const isDuplicateKey = (error) => error?.code === 11000;

const storeIgnoredDelivery = async ({ deliveryId, eventName, action, installationId = null, repositoryId = null }) => withMongoTransaction(async (session) => {
  await createInSession(GitHubWebhookDelivery, {
    deliveryId, eventName, action, installationId, repositoryId, outcome: "ignored",
  }, session);
});

const processDeploymentStatus = async ({ deliveryId, payload, eventName, action }) => {
  const deployment = normalizeGitHubDeploymentPayload(payload);
  return withMongoTransaction(async (session) => {
    await createInSession(GitHubWebhookDelivery, {
      deliveryId, eventName, action, installationId: deployment.installationId,
      repositoryId: deployment.repositoryId, outcome: "processed",
    }, session);
    const links = await inSession(GitHubRepositoryLink.find({
      installationId: deployment.installationId,
      repositoryId: deployment.repositoryId,
      active: true,
    }), session);
    let createdCount = 0;
    for (const link of links) {
      const exists = await inSession(GitHubDeployment.findOne({
        projectId: link.projectId, deploymentStatusId: deployment.deploymentStatusId,
      }).select("_id"), session);
      if (exists) continue;
      const record = await createInSession(GitHubDeployment, {
        projectId: link.projectId,
        ...deployment,
      }, session);
      await createAuditLogInSession({
        projectId: link.projectId, entityType: "github_deployment", entityId: record._id, flagId: null,
        action: "GITHUB_DEPLOYMENT_RECORDED", changedBy: "system", actorId: null,
        actorRole: "system", requestId: deliveryId, before: null,
        after: {
          repositoryFullName: record.repositoryFullName, state: record.state,
          environment: record.environment, sha: record.sha, ref: record.ref,
          deployedAt: record.deployedAt,
        },
      }, session);
      createdCount += 1;
    }
    return { linkedProjects: links.length, createdCount };
  });
};

const processInstallationChange = async ({ deliveryId, payload, eventName, action }) => {
  const installationId = parseGitHubNumericId(payload?.installation?.id, "installation.id");
  if (!["deleted", "suspend", "unsuspend"].includes(action)) {
    await storeIgnoredDelivery({ deliveryId, eventName, action, installationId });
    return { ignored: true };
  }
  return withMongoTransaction(async (session) => {
    await createInSession(GitHubWebhookDelivery, {
      deliveryId, eventName, action, installationId, outcome: "processed",
    }, session);
    const connections = await inSession(GitHubProjectInstallation.find({ installationId, disconnectedAt: null }), session);
    const globalInstallation = await inSession(GitHubInstallation.findOne({ installationId }), session);
    const now = new Date();
    const transition = buildGitHubInstallationTransition({
      action,
      previousSuspendedAt: globalInstallation?.suspendedAt || null,
      previousDisconnectedAt: null,
      now,
    });
    if (globalInstallation) {
      globalInstallation.suspendedAt = transition.after.suspendedAt;
      await globalInstallation.save(session ? { session } : undefined);
    }
    for (const connection of connections) {
      const before = { ...transition.before, disconnectedAt: connection.disconnectedAt };
      const nextDisconnectedAt = transition.after.disconnectedAt ?? connection.disconnectedAt;
      let disabledRepositoryCount = 0;
      if (action === "deleted") {
        connection.disconnectedAt = nextDisconnectedAt;
        await connection.save(session ? { session } : undefined);
        const update = await inSession(GitHubRepositoryLink.updateMany(
          { projectId: connection.projectId, installationId, active: true },
          { $set: { active: false, unlinkedAt: now } },
        ), session);
        disabledRepositoryCount = update.modifiedCount;
      }
      const auditAction = action === "deleted" ? "GITHUB_INSTALLATION_DISCONNECTED" : action === "suspend" ? "GITHUB_INSTALLATION_SUSPENDED" : "GITHUB_INSTALLATION_UNSUSPENDED";
      await createAuditLogInSession({
        projectId: connection.projectId, entityType: "github_installation", entityId: connection._id, flagId: null,
        action: auditAction, changedBy: "system", actorId: null,
        actorRole: "system", requestId: deliveryId, before,
        after: { installationId, action, ...transition.after, disconnectedAt: nextDisconnectedAt, disabledRepositoryCount, source: "github_webhook" },
      }, session);
    }
    return { affectedProjects: connections.length, action };
  });
};

const processRepositoryRemoval = async ({ deliveryId, payload, eventName, action }) => {
  const installationId = parseGitHubNumericId(payload?.installation?.id, "installation.id");
  const removed = Array.isArray(payload.repositories_removed) ? payload.repositories_removed : [];
  const removedIds = removed.map((repository) => parseGitHubNumericId(repository.id, "repository.id"));
  return withMongoTransaction(async (session) => {
    await createInSession(GitHubWebhookDelivery, {
      deliveryId, eventName, action, installationId, outcome: "processed",
    }, session);
    let removedCount = 0;
    for (const repositoryId of removedIds) {
      const links = await inSession(GitHubRepositoryLink.find({ installationId, repositoryId, active: true }), session);
      for (const link of links) {
        link.active = false;
        link.unlinkedAt = new Date();
        await link.save(session ? { session } : undefined);
        await createAuditLogInSession({
          projectId: link.projectId, entityType: "github_repository", entityId: link._id, flagId: null,
          action: "GITHUB_REPOSITORY_UNLINKED", changedBy: "system", actorId: null,
          actorRole: "system", requestId: deliveryId,
          before: { fullName: link.fullName, active: true },
          after: { fullName: link.fullName, active: false, source: "github_webhook" },
        }, session);
        removedCount += 1;
      }
    }
    return { removedCount };
  });
};

export const receiveGitHubWebhook = asyncHandler(async (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  const rawBody = req.body;
  if (!secret || !Buffer.isBuffer(rawBody) || !isValidGitHubWebhookSignature(rawBody, req.get("x-hub-signature-256"), secret)) {
    throw new ApiError(401, "Invalid GitHub webhook signature");
  }
  const deliveryId = String(req.get("x-github-delivery") || "").trim();
  const eventName = String(req.get("x-github-event") || "").trim();
  if (!/^[A-Za-z0-9-]{8,100}$/.test(deliveryId) || !/^[a-z_]{1,80}$/.test(eventName)) {
    throw new ApiError(400, "GitHub webhook delivery headers are invalid");
  }
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); }
  catch { throw new ApiError(400, "GitHub webhook payload is malformed JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ApiError(400, "GitHub webhook payload must be an object");
  const action = typeof payload.action === "string" ? payload.action.slice(0, 80) : null;

  try {
    if (eventName === "ping") {
      await storeIgnoredDelivery({ deliveryId, eventName, action });
      return res.status(200).json({ success: true, message: "GitHub webhook verified" });
    }
    let result;
    if (eventName === "deployment_status") {
      result = await processDeploymentStatus({ deliveryId, payload, eventName, action });
    } else if (eventName === "installation") {
      result = await processInstallationChange({ deliveryId, payload, eventName, action });
    } else if (eventName === "installation_repositories" && action === "removed") {
      result = await processRepositoryRemoval({ deliveryId, payload, eventName, action });
    } else {
      await storeIgnoredDelivery({
        deliveryId, eventName, action,
        installationId: payload.installation?.id ? parseGitHubNumericId(payload.installation.id, "installation.id") : null,
        repositoryId: payload.repository?.id ? parseGitHubNumericId(payload.repository.id, "repository.id") : null,
      });
      result = { ignored: true };
    }
    return res.status(202).json({ success: true, message: "GitHub webhook accepted", data: result });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const duplicatePattern = error.keyPattern || {};
      const duplicateValue = error.keyValue || {};
      const deploymentStatusCollision = eventName === "deployment_status" && (
        Object.hasOwn(duplicatePattern, "deploymentStatusId")
        || (Object.hasOwn(duplicateValue, "deploymentStatusId") && Object.hasOwn(duplicateValue, "projectId"))
        || String(error.message || "").includes("project_github_status_unique")
      );
      if (deploymentStatusCollision) {
        try {
          const reconciled = await processDeploymentStatus({ deliveryId, payload, eventName, action });
          return res.status(202).json({
            success: true, duplicateStatus: true, reconciled: true,
            data: reconciled,
            message: "Duplicate GitHub deployment status reconciled",
          });
        } catch (retryError) {
          if (!isDuplicateKey(retryError)) throw retryError;
          const deployment = normalizeGitHubDeploymentPayload(payload);
          try {
            await storeIgnoredDelivery({
              deliveryId, eventName, action,
              installationId: deployment.installationId,
              repositoryId: deployment.repositoryId,
            });
          } catch (recordError) {
            if (isDuplicateKey(recordError)) {
              return res.status(202).json({ success: true, duplicate: true, message: "GitHub webhook delivery already processed" });
            }
            throw recordError;
          }
          return res.status(202).json({ success: true, duplicateStatus: true, message: "GitHub deployment status was already recorded" });
        }
      }
      return res.status(202).json({ success: true, duplicate: true, message: "GitHub webhook delivery already processed" });
    }
    throw error;
  }
});
