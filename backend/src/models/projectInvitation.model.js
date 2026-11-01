import mongoose from "mongoose";

const projectInvitationSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, immutable: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, immutable: true },
  role: { type: String, enum: ["admin", "developer", "viewer"], required: true, immutable: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  tokenHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["pending", "accepted", "expired", "revoked"], default: "pending", required: true },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date, default: null },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  revokedAt: { type: Date, default: null },
  lastSentAt: { type: Date, default: null },
  lastResentAt: { type: Date, default: null },
  sendCount: { type: Number, default: 0, min: 0 },
  emailDeliveryStatus: { type: String, enum: ["not_configured", "sending", "sent", "failed"], default: "not_configured" },
  deliveryAttempts: { type: Number, default: 0, min: 0 },
  lastAttemptAt: { type: Date, default: null },
  lastDeliveryErrorCode: { type: String, default: null, maxlength: 80 },
}, { timestamps: true, optimisticConcurrency: true });

projectInvitationSchema.index(
  { projectId: 1, email: 1 },
  { name: "one_pending_invitation_per_project_email", unique: true, partialFilterExpression: { status: "pending" } },
);
projectInvitationSchema.index({ tokenHash: 1 }, { name: "invitation_token_hash_unique", unique: true });
projectInvitationSchema.index({ projectId: 1, status: 1, createdAt: -1 }, { name: "project_invitation_status_createdAt" });

export const ProjectInvitation = mongoose.model("ProjectInvitation", projectInvitationSchema);
