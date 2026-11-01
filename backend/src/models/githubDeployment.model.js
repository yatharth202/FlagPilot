import mongoose from "mongoose";

const githubDeploymentSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, immutable: true },
  installationId: { type: Number, required: true, immutable: true },
  repositoryId: { type: Number, required: true, immutable: true },
  repositoryFullName: { type: String, required: true, maxlength: 200, immutable: true },
  deploymentId: { type: String, required: true, immutable: true },
  deploymentStatusId: { type: String, required: true, immutable: true },
  state: { type: String, enum: ["queued", "pending", "in_progress", "success", "failure", "error", "inactive"], required: true, immutable: true },
  environment: { type: String, required: true, maxlength: 100, immutable: true },
  sha: { type: String, required: true, maxlength: 64, immutable: true },
  ref: { type: String, default: null, maxlength: 255, immutable: true },
  description: { type: String, default: null, maxlength: 500, immutable: true },
  environmentUrl: { type: String, default: null, maxlength: 1000, immutable: true },
  logUrl: { type: String, default: null, maxlength: 1000, immutable: true },
  creatorLogin: { type: String, default: null, maxlength: 100, immutable: true },
  deployedAt: { type: Date, required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

githubDeploymentSchema.index({ projectId: 1, deploymentStatusId: 1 }, { unique: true, name: "project_github_status_unique" });
githubDeploymentSchema.index({ projectId: 1, deployedAt: -1, _id: -1 }, { name: "project_github_deployments" });
export const GitHubDeployment = mongoose.model("GitHubDeployment", githubDeploymentSchema);
