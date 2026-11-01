import mongoose from "mongoose";

const approvalRequestSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  flagId: { type: mongoose.Schema.Types.ObjectId, ref: "FeatureFlag", required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: {
    type: String,
    enum: ["UPDATE_SETTINGS", "UPDATE_TARGETING", "TOGGLE_FLAG", "COPY_TO_ENVIRONMENT"],
    required: true,
  },
  targetEnvironment: { type: String, enum: ["prod"], required: true, default: "prod" },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  sourceSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

  baseUpdatedAt: { type: Date, default: null },
  baseVersion: { type: Number, default: null },
  processingAt: { type: Date, default: null },
  processingToken: { type: String, default: null, select: false },
  status: { type: String, enum: ["pending", "processing", "approved", "rejected", "failed"], default: "pending", index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewComment: { type: String, default: "", maxlength: 1000 },
  failureReason: { type: String, default: "", maxlength: 500 },
}, { timestamps: true });

approvalRequestSchema.index({ projectId: 1, status: 1, createdAt: -1 }, { name: "project_approval_status_createdAt" });

export const ApprovalRequest = mongoose.model("ApprovalRequest", approvalRequestSchema);
