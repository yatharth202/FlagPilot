import mongoose from "mongoose";
import { Project } from "../models/project.model.js";
import { ProjectInvitation } from "../models/projectInvitation.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { canAssignProjectRole, resolveProjectRole } from "../utils/projectRole.js";
import {
  generateInvitationToken, getInvitationTtlMs, hashInvitationToken,
  isInvitationUsable, isValidInvitationEmail, isValidInvitationToken,
  normalizeInvitationEmail, getInvitationResendCooldownRemainingMs, isPendingInvitationDuplicateKeyError,
} from "../utils/projectInvitationPolicy.js";
import { withMongoTransaction, inSession, createInSession } from "../utils/withMongoTransaction.js";
import { createAuditLogInSession } from "../utils/auditLog.js";
import { isInvitationEmailConfigured, sendProjectInvitationEmail } from "../services/invitationEmail.service.js";

const serializeInvitation = (invitation) => ({
  id: String(invitation._id),
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
  createdAt: invitation.createdAt,
  lastSentAt: invitation.lastSentAt,
  lastResentAt: invitation.lastResentAt || null,
  sendCount: invitation.sendCount,
  emailDeliveryStatus: invitation.emailDeliveryStatus,
  deliveryAttempts: invitation.deliveryAttempts || 0,
  lastAttemptAt: invitation.lastAttemptAt || null,
});

const makeAudit = ({ projectId, invitation, action, actorId = null, actorRole = "system", requestId = null, before = null, after = {} }) => ({
  projectId,
  entityType: "project_invitation",
  entityId: invitation._id,
  flagId: null,
  action,
  changedBy: actorId || "system",
  actorId,
  actorRole,
  requestId,
  before,
  after,
});

const markExpired = async (invitationId, requestId = null) => withMongoTransaction(async (session) => {
  const invitation = await inSession(ProjectInvitation.findOne({
    _id: invitationId,
    status: "pending",
    expiresAt: { $lte: new Date() },
  }), session);
  if (!invitation) return false;
  const result = await inSession(ProjectInvitation.updateOne(
    { _id: invitation._id, status: "pending", expiresAt: { $lte: new Date() } },
    { $set: { status: "expired" } },
  ), session);
  if (result.modifiedCount !== 1) return false;
  await createAuditLogInSession(makeAudit({
    projectId: invitation.projectId,
    invitation,
    action: "EXPIRE_INVITATION",
    requestId,
    before: { status: "pending", expiresAt: invitation.expiresAt },
    after: { status: "expired" },
  }), session);
  return true;
});

const recordDelivery = async ({ invitationId, status, requestId, actorId, actorRole, errorCode = null }) => withMongoTransaction(async (session) => {
  const invitation = await inSession(ProjectInvitation.findById(invitationId), session);
  if (!invitation || invitation.status !== "pending") return null;
  const before = { emailDeliveryStatus: invitation.emailDeliveryStatus, sendCount: invitation.sendCount, deliveryAttempts: invitation.deliveryAttempts };
  invitation.emailDeliveryStatus = status;
  invitation.lastDeliveryErrorCode = errorCode;
  if (status === "sending") {
    invitation.deliveryAttempts = Number(invitation.deliveryAttempts || 0) + 1;
    invitation.lastAttemptAt = new Date();
  }
  invitation.sendCount = Number(invitation.sendCount || 0) + (status === "sent" ? 1 : 0);
  invitation.lastSentAt = status === "sent" ? new Date() : invitation.lastSentAt;
  await invitation.save(session ? { session } : undefined);
  await createAuditLogInSession(makeAudit({
    projectId: invitation.projectId,
    invitation,
    action: status === "sending" ? "INVITATION_EMAIL_ATTEMPTED" : status === "failed" ? "INVITATION_EMAIL_FAILED" : status === "sent" ? "INVITATION_EMAIL_SENT" : "INVITATION_LINK_CREATED",
    actorId,
    actorRole,
    requestId,
    before,
    after: { emailDeliveryStatus: status, errorCode, deliveryAttempts: invitation.deliveryAttempts, sendCount: invitation.sendCount },
  }), session);
  return invitation;
});

const deliverInvitation = async ({ invitation, token, projectName, inviterName, requestId, actorId, actorRole }) => {
  if (!isInvitationEmailConfigured() && process.env.NODE_ENV !== "production") {
    const delivery = await sendProjectInvitationEmail({
      email: invitation.email, projectName, inviterName, role: invitation.role, token, expiresAt: invitation.expiresAt,
    });
    const updated = await recordDelivery({ invitationId: invitation._id, status: "not_configured", requestId, actorId, actorRole });
    return { invitation: updated || invitation, invitationUrl: delivery.invitationUrl };
  }


  await recordDelivery({ invitationId: invitation._id, status: "sending", requestId, actorId, actorRole });
  let delivery;
  try {
    delivery = await sendProjectInvitationEmail({
      email: invitation.email, projectName, inviterName, role: invitation.role,
      token, expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    const updated = await recordDelivery({
      invitationId: invitation._id, status: "failed", requestId, actorId, actorRole,
      errorCode: error.deliveryCode || "DELIVERY_FAILED",
    }).catch(() => null);
    return { invitation: updated || invitation, invitationUrl: null, deliveryError: error.message };
  }

  try {
    const updated = await recordDelivery({ invitationId: invitation._id, status: delivery.status, requestId, actorId, actorRole });
    return { invitation: updated || invitation, invitationUrl: process.env.NODE_ENV === "production" ? null : delivery.invitationUrl };
  } catch {

    return {
      invitation,
      invitationUrl: process.env.NODE_ENV === "production" ? null : delivery.invitationUrl,
      deliveryError: "Email provider accepted the request, but delivery status could not be saved. Check provider activity before resending.",
    };
  }
};

const assertCanManageInvitation = (req, invitation) => {
  if (!canAssignProjectRole(req.projectRole, invitation.role)) {
    throw new ApiError(403, req.projectRole === "admin" ? "Admins cannot manage Admin invitations" : "You cannot manage this invitation");
  }
};

const expireStaleProjectInvitations = async (projectId, requestId) => {
  const expired = await ProjectInvitation.find({ projectId, status: "pending", expiresAt: { $lte: new Date() } }).select("_id").limit(100).lean();
  for (const item of expired) await markExpired(item._id, requestId);
};

export const createProjectInvitation = asyncHandler(async (req, res) => {
  const email = normalizeInvitationEmail(req.body?.email);
  const role = req.body?.role || "developer";
  if (!isValidInvitationEmail(email)) throw new ApiError(400, "Enter a valid email address");
  if (!["admin", "developer", "viewer"].includes(role)) throw new ApiError(400, "Invitation role must be admin, developer, or viewer");
  if (!canAssignProjectRole(req.projectRole, role)) {
    throw new ApiError(403, req.projectRole === "admin" ? "Admins can invite Developers and Viewers only" : "Only the project owner or an authorized Admin can invite members");
  }
  const invitedUser = await User.findOne({ email }).select("_id");
  if (String(invitedUser?._id || "") === String(req.user._id) || email === normalizeInvitationEmail(req.user.email)) {
    throw new ApiError(400, "You cannot invite yourself to your own project");
  }
  const projectOwner = await User.findById(req.project.ownerId).select("_id email");
  if ((invitedUser && String(invitedUser._id) === String(req.project.ownerId)) || (projectOwner && email === normalizeInvitationEmail(projectOwner.email))) {
    throw new ApiError(409, "The project owner is already a member");
  }
  if (process.env.NODE_ENV === "production" && !isInvitationEmailConfigured()) {
    throw new ApiError(503, "Invitation email delivery is not configured. Set RESEND_API_KEY, EMAIL_FROM, and FRONTEND_ORIGIN.");
  }
  if (invitedUser && req.project.members.some((member) => String(member.userId) === String(invitedUser._id))) {
    throw new ApiError(409, "This account is already a project member");
  }

  await expireStaleProjectInvitations(req.project._id, req.id);
  const staleForEmail = await ProjectInvitation.findOne({ projectId: req.project._id, email, status: "pending", expiresAt: { $lte: new Date() } }).select("_id");
  if (staleForEmail) await markExpired(staleForEmail._id, req.id);
  const existingPending = await ProjectInvitation.findOne({ projectId: req.project._id, email, status: "pending" });
  if (existingPending) throw new ApiError(409, "A pending invitation already exists for this email. Resend it instead.");

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + getInvitationTtlMs());
  const invitation = await withMongoTransaction(async (session) => {
    const project = await inSession(Project.findOne({ _id: req.project._id, archivedAt: null }), session);
    if (!project) throw new ApiError(404, "Project not found or archived");
    const alreadyMember = project.members.some((member) => invitedUser && String(member.userId) === String(invitedUser._id));
    if (alreadyMember || String(project.ownerId) === String(invitedUser?._id || "")) throw new ApiError(409, "This account is already part of the project");
    const created = await createInSession(ProjectInvitation, {
      projectId: project._id,
      email,
      role,
      invitedBy: req.user._id,
      tokenHash: hashInvitationToken(token),
      status: "pending",
      expiresAt,
    }, session);
    await createAuditLogInSession(makeAudit({
      projectId: project._id,
      invitation: created,
      action: "CREATE_INVITATION",
      actorId: req.user._id,
      actorRole: req.projectRole,
      requestId: req.id,
      before: null,
      after: { email, role, status: "pending", expiresAt },
    }), session);
    return created;
  }).catch((error) => {
    if (isPendingInvitationDuplicateKeyError(error)) {
      throw new ApiError(409, "A pending invitation already exists for this email. Resend it instead.");
    }
    throw error;
  });

  const delivery = await deliverInvitation({
    invitation,
    token,
    projectName: req.project.name,
    inviterName: req.user.name,
    requestId: req.id,
    actorId: req.user._id,
    actorRole: req.projectRole,
  });
  const statusCode = delivery.deliveryError ? 202 : 201;
  return res.status(statusCode).json(new ApiResponse(statusCode, {
    ...serializeInvitation(delivery.invitation),
    invitationUrl: delivery.invitationUrl,
    deliveryWarning: delivery.deliveryError || null,
  }, delivery.deliveryError ? "Invitation created but email delivery failed; resend it after checking email configuration" : "Invitation created"));
});

export const listProjectInvitations = asyncHandler(async (req, res) => {
  await expireStaleProjectInvitations(req.project._id, req.id);
  const rows = await ProjectInvitation.find({ projectId: req.project._id })
    .populate({ path: "invitedBy", select: "name email" })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return res.status(200).json(new ApiResponse(200, rows.map((row) => ({
    ...serializeInvitation(row),
    invitedBy: row.invitedBy ? { id: String(row.invitedBy._id), name: row.invitedBy.name, email: row.invitedBy.email } : null,
  })), "Project invitations loaded"));
});

export const resendProjectInvitation = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === "production" && !isInvitationEmailConfigured()) {
    throw new ApiError(503, "Invitation email delivery is not configured. Set RESEND_API_KEY, EMAIL_FROM, and FRONTEND_ORIGIN.");
  }
  if (!mongoose.isValidObjectId(req.params.invitationId)) throw new ApiError(400, "Invalid invitation ID");
  const current = await ProjectInvitation.findOne({ _id: req.params.invitationId, projectId: req.project._id });
  if (!current) throw new ApiError(404, "Invitation not found");
  assertCanManageInvitation(req, current);
  if (!isInvitationUsable(current)) {
    if (current.status === "pending" && new Date(current.expiresAt).getTime() <= Date.now()) await markExpired(current._id, req.id);
    throw new ApiError(410, "This invitation is no longer pending. Create a new invitation instead.");
  }

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + getInvitationTtlMs());
  const updated = await withMongoTransaction(async (session) => {
    const invitation = await inSession(ProjectInvitation.findOne({
      _id: current._id, projectId: req.project._id, status: "pending", expiresAt: { $gt: new Date() },
    }), session);
    if (!invitation) throw new ApiError(409, "Invitation changed while it was being resent; refresh and retry");
    const cooldownRemaining = getInvitationResendCooldownRemainingMs(invitation.lastResentAt);
    if (cooldownRemaining > 0) {
      throw new ApiError(429, `Wait ${Math.ceil(cooldownRemaining / 1000)} seconds before resending this invitation`);
    }
    const resentAt = new Date();
    const before = { expiresAt: invitation.expiresAt, emailDeliveryStatus: invitation.emailDeliveryStatus, lastResentAt: invitation.lastResentAt || null };
    invitation.tokenHash = hashInvitationToken(token);
    invitation.expiresAt = expiresAt;
    invitation.lastResentAt = resentAt;
    invitation.emailDeliveryStatus = "not_configured";
    invitation.lastDeliveryErrorCode = null;
    await invitation.save(session ? { session } : undefined);
    await createAuditLogInSession(makeAudit({
      projectId: req.project._id, invitation, action: "RESEND_INVITATION",
      actorId: req.user._id, actorRole: req.projectRole, requestId: req.id,
      before, after: { expiresAt, lastResentAt: resentAt, emailDeliveryStatus: "not_configured" },
    }), session);
    return invitation;
  });
  const delivery = await deliverInvitation({
    invitation: updated, token, projectName: req.project.name, inviterName: req.user.name,
    requestId: req.id, actorId: req.user._id, actorRole: req.projectRole,
  });
  return res.status(200).json(new ApiResponse(200, {
    ...serializeInvitation(delivery.invitation),
    invitationUrl: delivery.invitationUrl,
    deliveryWarning: delivery.deliveryError || null,
  }, delivery.deliveryError ? "Invitation token rotated but email delivery failed" : "Invitation resent"));
});

export const revokeProjectInvitation = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.invitationId)) throw new ApiError(400, "Invalid invitation ID");
  const invitation = await withMongoTransaction(async (session) => {
    const current = await inSession(ProjectInvitation.findOne({
      _id: req.params.invitationId, projectId: req.project._id, status: "pending",
    }), session);
    if (!current) throw new ApiError(404, "Pending invitation not found");
    assertCanManageInvitation(req, current);
    const before = { email: current.email, role: current.role, status: current.status };
    current.status = "revoked";
    current.revokedAt = new Date();
    await current.save(session ? { session } : undefined);
    await createAuditLogInSession(makeAudit({
      projectId: req.project._id, invitation: current, action: "REVOKE_INVITATION",
      actorId: req.user._id, actorRole: req.projectRole, requestId: req.id,
      before, after: { status: "revoked", revokedAt: current.revokedAt },
    }), session);
    return current;
  });
  return res.status(200).json(new ApiResponse(200, serializeInvitation(invitation), "Invitation revoked"));
});


export const getInvitationPreview = asyncHandler(async (req, res) => {
  const token = req.body?.token;
  if (!isValidInvitationToken(token)) throw new ApiError(404, "Invitation link is invalid or no longer available");
  const tokenHash = hashInvitationToken(token);
  const invitation = await ProjectInvitation.findOne({ tokenHash, status: "pending" })
    .select("+tokenHash")
    .populate({ path: "projectId", select: "name archivedAt" })
    .populate({ path: "invitedBy", select: "name" });
  if (!invitation) throw new ApiError(404, "Invitation link is invalid or no longer available");
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    await markExpired(invitation._id, req.id);
    throw new ApiError(410, "This invitation has expired");
  }
  if (!invitation.projectId || invitation.projectId.archivedAt) throw new ApiError(410, "This project is no longer accepting invitations");
  return res.status(200).json(new ApiResponse(200, {
    email: invitation.email,
    role: invitation.role,
    project: { id: String(invitation.projectId._id), name: invitation.projectId.name },
    invitedBy: invitation.invitedBy?.name || "A FlagPilot teammate",
    expiresAt: invitation.expiresAt,
  }, "Invitation details loaded"));
});


export const acceptProjectInvitation = asyncHandler(async (req, res) => {
  const token = req.body?.token;
  if (!isValidInvitationToken(token)) throw new ApiError(400, "A valid invitation token is required");
  const tokenHash = hashInvitationToken(token);
  const result = await withMongoTransaction(async (session) => {
    const invitation = await inSession(ProjectInvitation.findOne({ tokenHash, status: "pending" }).select("+tokenHash"), session);
    if (!invitation) throw new ApiError(404, "Invitation is invalid, already used, or revoked");
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      invitation.status = "expired";
      await invitation.save(session ? { session } : undefined);
      await createAuditLogInSession(makeAudit({
        projectId: invitation.projectId, invitation, action: "EXPIRE_INVITATION",
        requestId: req.id, before: { status: "pending" }, after: { status: "expired" },
      }), session);
      return { expired: true };
    }
    const user = await inSession(User.findById(req.user._id), session);
    if (!user) throw new ApiError(401, "Account not found");
    if (normalizeInvitationEmail(user.email) !== invitation.email) {
      throw new ApiError(403, "Sign in with the email address this invitation was sent to");
    }
    const project = await inSession(Project.findOne({ _id: invitation.projectId, archivedAt: null }), session);
    if (!project) throw new ApiError(410, "This project is archived and cannot accept members");
    const existingRole = resolveProjectRole(project, user._id);
    if (!existingRole) {
      const update = await inSession(Project.updateOne(
        { _id: project._id, archivedAt: null, members: { $not: { $elemMatch: { userId: user._id } } } },
        { $push: { members: { userId: user._id, role: invitation.role } }, $inc: { __v: 1 } },
      ), session);
      if (update.modifiedCount !== 1) throw new ApiError(409, "Project membership changed while accepting; refresh and retry");
    }
    const previousStatus = invitation.status;
    invitation.status = "accepted";
    invitation.acceptedAt = new Date();
    invitation.acceptedBy = user._id;
    await invitation.save(session ? { session } : undefined);
    if (!user.defaultProjectId && !user.projectId) {
      user.defaultProjectId = project._id;
      user.projectId = project._id;
      await user.save({ ...(session ? { session } : {}), validateBeforeSave: false });
    }
    await createAuditLogInSession(makeAudit({
      projectId: project._id, invitation, action: "ACCEPT_INVITATION",
      actorId: user._id, actorRole: "invited", requestId: req.id,
      before: { status: previousStatus },
      after: { status: "accepted", acceptedBy: String(user._id), role: existingRole || invitation.role },
    }), session);
    return { expired: false, project: { id: String(project._id), name: project.name }, role: existingRole || invitation.role };
  });
  if (result.expired) throw new ApiError(410, "This invitation has expired");
  return res.status(200).json(new ApiResponse(200, result, "Invitation accepted. The project is now available in your workspace."));
});
