import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true, immutable: true },

    flagId: { type: mongoose.Schema.Types.ObjectId, ref: "FeatureFlag", default: null, immutable: true },
    entityType: {
      type: String,
      enum: ["feature_flag", "project", "project_member", "client_key", "approval_request", "project_invitation", "github_installation", "github_repository", "github_deployment"],
      default: "feature_flag",
      required: true,
      immutable: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    action: {
      type: String,
      enum: [
        "CREATE_FLAG", "UPDATE_TARGETING", "ROLLBACK", "UPDATE_SETTINGS", "TOGGLE_FLAG",
        "COPY_TO_ENVIRONMENT", "APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED",
        "APPROVAL_FAILED", "ADD_PROJECT_MEMBER", "REMOVE_PROJECT_MEMBER", "UPDATE_PROJECT", "CREATE_PROJECT", "ARCHIVE_PROJECT", "ROTATE_CLIENT_KEY",
        "CREATE_INVITATION", "RESEND_INVITATION", "REVOKE_INVITATION", "EXPIRE_INVITATION", "ACCEPT_INVITATION",
        "INVITATION_EMAIL_ATTEMPTED", "INVITATION_EMAIL_SENT", "INVITATION_EMAIL_FAILED", "INVITATION_LINK_CREATED",
        "GITHUB_INSTALLATION_CONNECTED", "GITHUB_INSTALLATION_DISCONNECTED", "GITHUB_INSTALLATION_SUSPENDED", "GITHUB_INSTALLATION_UNSUSPENDED", "GITHUB_REPOSITORY_LINKED", "GITHUB_REPOSITORY_UNLINKED", "GITHUB_DEPLOYMENT_RECORDED",
      ],
      required: true,
      immutable: true,
    },

    changedBy: { type: String, required: true, immutable: true, maxlength: 128 },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
    actorType: { type: String, enum: ["user", "system", "legacy"], required: true, immutable: true },
    actorRole: { type: String, enum: ["owner", "admin", "developer", "viewer", "invited", "system", "unknown"], required: true, immutable: true },
    requestId: { type: String, default: null, immutable: true, maxlength: 80 },
    before: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    after: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    strict: "throw",
  },
);

auditLogSchema.index({ projectId: 1, flagId: 1, createdAt: -1 }, { name: "project_flag_createdAt" });
auditLogSchema.index({ projectId: 1, createdAt: -1, _id: -1 }, { name: "project_createdAt_id" });
auditLogSchema.index({ projectId: 1, entityType: 1, createdAt: -1, _id: -1 }, { name: "project_entityType_createdAt_id" });
auditLogSchema.index({ projectId: 1, entityType: 1, entityId: 1, createdAt: -1 }, { name: "project_entity_createdAt" });

const immutableError = () => new Error("Audit logs are append-only; updates and deletions are forbidden");
auditLogSchema.pre("save", function () {
  if (!this.isNew) throw immutableError();
});
auditLogSchema.pre("deleteOne", { document: true, query: false }, function () {
  throw immutableError();
});
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  auditLogSchema.pre(operation, function () {
    throw immutableError();
  });
}
auditLogSchema.pre("bulkWrite", function () {
  throw immutableError();
});

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
