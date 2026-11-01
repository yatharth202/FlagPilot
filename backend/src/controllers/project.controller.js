import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { Project } from "../models/project.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { canRemoveProjectMember, resolveProjectRole } from "../utils/projectRole.js";
import { buildAccessibleProjectsFilter } from "../utils/projectAccessPolicy.js";
import { withMongoTransaction, inSession, createInSession } from "../utils/withMongoTransaction.js";
import { createAuditLogInSession } from "../utils/auditLog.js";

const findFallbackProject = async (userId, excludedProjectId, session) => {
  const candidates = await inSession(Project.find({
    ...buildAccessibleProjectsFilter(userId),
    _id: { $ne: excludedProjectId },
  }).sort({ createdAt: 1 }).select("ownerId members"), session);
  return candidates.find((candidate) => resolveProjectRole(candidate, userId)) || null;
};

const serializeProject = (project, userId) => ({
  id: String(project._id),
  name: project.name,
  role: resolveProjectRole(project, userId),
  ownerId: String(project.ownerId),
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});


export const listAccessibleProjects = asyncHandler(async (req, res) => {
  const projects = await Project.find(buildAccessibleProjectsFilter(req.user._id))
    .sort({ updatedAt: -1, createdAt: -1 })
    .select("name ownerId members createdAt updatedAt")
    .lean();

  const accessible = projects
    .map((project) => serializeProject(project, req.user._id))
    .filter((project) => project.role);

  return res.status(200).json(new ApiResponse(200, accessible, "Projects loaded"));
});


export const createProject = asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 100) {
    throw new ApiError(400, "Project name is required and must be at most 100 characters");
  }

  const created = await withMongoTransaction(async (session) => {
    const owner = await inSession(User.findById(req.user._id), session);
    if (!owner) throw new ApiError(401, "Account not found");

    const project = await createInSession(Project, { ownerId: owner._id, name }, session);
    const beforeDefault = owner.defaultProjectId || owner.projectId || null;
    if (!beforeDefault) {
      owner.defaultProjectId = project._id;
      owner.projectId = project._id; // legacy compatibility alias
      await owner.save(session ? { session, validateBeforeSave: false } : { validateBeforeSave: false });
    }

    await createAuditLogInSession({
      projectId: project._id,
      entityType: "project",
      entityId: project._id,
      flagId: null,
      action: "CREATE_PROJECT",
      changedBy: owner._id,
      actorId: owner._id,
      actorRole: "owner",
      requestId: req.id,
      before: { defaultProjectId: beforeDefault ? String(beforeDefault) : null },
      after: { name: project.name, ownerId: String(owner._id) },
    }, session);

    return project;
  });

  return res.status(201).json(new ApiResponse(201, {
    ...serializeProject(created, req.user._id),
    clientKeys: { dev: created.devClientKey, prod: created.prodClientKey },
  }, "Project created"));
});


export const selectProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, "Invalid project ID");

  const project = await Project.findOne({
    _id: projectId,
    ...buildAccessibleProjectsFilter(req.user._id),
  }).select("name ownerId members createdAt updatedAt");
  if (!project || !resolveProjectRole(project, req.user._id)) {
    throw new ApiError(404, "Project not found or you do not have access to it");
  }

  await User.updateOne(
    { _id: req.user._id },
    { $set: { defaultProjectId: project._id, projectId: project._id } },
  );

  return res.status(200).json(new ApiResponse(200, serializeProject(project, req.user._id), "Active project selected"));
});

export const getCurrentProject = asyncHandler(async (req, res) => {
  const project = req.project;
  return res.status(200).json(new ApiResponse(200, {
    id: project._id,
    name: project.name,
    role: req.projectRole,
    ownerId: project.ownerId,
    clientKeys: { dev: project.devClientKey, prod: project.prodClientKey },
    createdAt: project.createdAt,
  }, "Project loaded"));
});

export const updateCurrentProject = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 100) throw new ApiError(400, "Project name is required and must be at most 100 characters");
  const updated = await withMongoTransaction(async (session) => {
    const project = await inSession(Project.findById(req.project._id), session);
    if (!project) throw new ApiError(404, "Project not found");
    const before = { name: project.name };
    project.name = name;
    await project.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId: project._id, entityType: "project", entityId: project._id, flagId: null,
      action: "UPDATE_PROJECT", changedBy: req.user._id, actorId: req.user._id,
      actorRole: req.projectRole, requestId: req.id, before, after: { name: project.name },
    }, session);
    return project;
  });
  return res.status(200).json(new ApiResponse(200, { id: updated._id, name: updated.name }, "Project updated"));
});


export const archiveCurrentProject = asyncHandler(async (req, res) => {
  const archived = await withMongoTransaction(async (session) => {
    const project = await inSession(Project.findOne({ _id: req.project._id, archivedAt: null }), session);
    if (!project) throw new ApiError(404, "Project not found or already archived");
    const before = { name: project.name, archivedAt: project.archivedAt || null };
    const actorFallback = await findFallbackProject(req.user._id, project._id, session);
    if (!actorFallback) {
      throw new ApiError(409, "Create or join another project before archiving your only active project");
    }

    project.archivedAt = new Date();
    await project.save(session ? { session } : undefined);

    const affectedUsers = await inSession(User.find({
      $or: [{ defaultProjectId: project._id }, { projectId: project._id }],
    }), session);
    for (const target of affectedUsers) {
      const preferredId = target.defaultProjectId || target.projectId;
      if (String(preferredId || "") === String(project._id)) {
        const fallback = await findFallbackProject(target._id, project._id, session);
        target.defaultProjectId = fallback?._id || null;
        target.projectId = fallback?._id || null;
      } else if (target.defaultProjectId) {

        target.projectId = target.defaultProjectId;
      }

      await target.save({ ...(session ? { session } : {}), validateBeforeSave: false });
    }

    await createAuditLogInSession({
      projectId: project._id, entityType: "project", entityId: project._id, flagId: null,
      action: "ARCHIVE_PROJECT", changedBy: req.user._id, actorId: req.user._id,
      actorRole: req.projectRole, requestId: req.id,
      before, after: { name: project.name, archivedAt: project.archivedAt },
    }, session);

    return { projectId: project._id, affectedUsers: affectedUsers.length };
  });

  return res.status(200).json(new ApiResponse(200, archived, "Project archived. Its data and audit history have been retained."));
});

export const rotateClientKey = asyncHandler(async (req, res) => {
  const { environment } = req.body || {};
  if (!["dev", "prod"].includes(environment)) throw new ApiError(400, "environment must be dev or prod");
  const updated = await withMongoTransaction(async (session) => {
    const project = await inSession(Project.findById(req.project._id), session);
    if (!project) throw new ApiError(404, "Project not found");
    const field = environment === "dev" ? "devClientKey" : "prodClientKey";
    const before = { environment, clientKeyFingerprint: project[field] ? project[field].slice(-8) : null };
    project[field] = `fp_${environment}_${randomBytes(24).toString("base64url")}`;
    await project.save(session ? { session } : undefined);
    await createAuditLogInSession({
      projectId: project._id, entityType: "client_key", entityId: project._id, flagId: null,
      action: "ROTATE_CLIENT_KEY", changedBy: req.user._id, actorId: req.user._id,
      actorRole: req.projectRole, requestId: req.id, before,
      after: { environment, clientKeyFingerprint: project[field].slice(-8) },
    }, session);
    return project[field];
  });
  return res.status(200).json(new ApiResponse(200, {
    environment, clientKey: updated,
    warning: "Update every app using the old key; the old key is revoked immediately.",
  }, "Client key rotated"));
});

export const listProjectMembers = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.project._id)
    .populate({ path: "ownerId", select: "name email" })
    .populate({ path: "members.userId", select: "name email" });
  const members = [
    { id: String(project.ownerId._id), name: project.ownerId.name, email: project.ownerId.email, role: "owner", isOwner: true },
    ...project.members.filter((item) => item.userId).map((item) => ({
      id: String(item.userId._id), name: item.userId.name, email: item.userId.email,
      role: item.role, isOwner: false, addedAt: item.addedAt,
    })),
  ];
  return res.status(200).json(new ApiResponse(200, members, "Project members loaded"));
});

export const removeProjectMember = asyncHandler(async (req, res) => {
  const memberId = req.params.userId;
  if (!mongoose.isValidObjectId(memberId)) throw new ApiError(400, "Invalid member ID");
  const membership = req.project.members.find((item) => String(item.userId) === String(memberId));
  if (!membership) throw new ApiError(404, "Project member not found");
  if (!canRemoveProjectMember(req.projectRole, membership.role)) {
    throw new ApiError(403, req.projectRole === "admin" ? "Admins can remove Developer or Viewer members only" : "Only the project owner can remove this member");
  }

  const result = await withMongoTransaction(async (session) => {
    const project = await inSession(Project.findById(req.project._id), session);
    const target = await inSession(User.findById(memberId), session);
    if (!project || !target) throw new ApiError(404, "Project or member account not found");

    const liveMembership = project.members.find((item) => String(item.userId) === String(target._id));
    if (!liveMembership || liveMembership.role !== membership.role) {
      throw new ApiError(409, "Project membership changed concurrently; refresh and retry");
    }

    const pull = await inSession(Project.updateOne(
      { _id: project._id, members: { $elemMatch: { userId: target._id, role: membership.role } } },
      { $pull: { members: { userId: target._id } }, $inc: { __v: 1 } },
    ), session);
    if (pull.modifiedCount !== 1) throw new ApiError(409, "Project membership changed while removing the member");

    const activeId = target.defaultProjectId || target.projectId;
    let fallbackProject = null;
    if (String(activeId || "") === String(project._id)) {
      fallbackProject = await findFallbackProject(target._id, project._id, session);
    }

    target.refreshToken = undefined;
    target.authVersion = Number(target.authVersion || 0) + 1;
    if (String(activeId || "") === String(project._id)) {
      target.defaultProjectId = fallbackProject?._id || null;
      target.projectId = fallbackProject?._id || null; // legacy compatibility alias
    }
    await target.save({ ...(session ? { session } : {}), validateBeforeSave: false });

    await createAuditLogInSession({
      projectId: project._id, entityType: "project_member", entityId: target._id, flagId: null,
      action: "REMOVE_PROJECT_MEMBER", changedBy: req.user._id, actorId: req.user._id,
      actorRole: req.projectRole, requestId: req.id,
      before: { role: membership.role }, after: { membership: null },
    }, session);
    return { member: target, fallbackProjectId: fallbackProject?._id || null };
  });

  return res.status(200).json(new ApiResponse(200, {
    id: result.member._id, name: result.member.name, fallbackProjectId: result.fallbackProjectId,
  }, "Member removed from this project. Their other project memberships remain unchanged."));
});
