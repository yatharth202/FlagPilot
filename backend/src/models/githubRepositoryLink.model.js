import mongoose from "mongoose";

const githubRepositoryLinkSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, immutable: true },
  installationId: { type: Number, required: true },
  repositoryId: { type: Number, required: true },
  fullName: { type: String, required: true, trim: true, maxlength: 200 },
  htmlUrl: { type: String, required: true, maxlength: 500 },
  ownerLogin: { type: String, required: true, maxlength: 100 },
  defaultBranch: { type: String, default: "main", maxlength: 255 },
  isPrivate: { type: Boolean, default: false },
  active: { type: Boolean, default: true, index: true },
  linkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  linkedAt: { type: Date, default: Date.now },
  unlinkedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

githubRepositoryLinkSchema.index({ projectId: 1, repositoryId: 1 }, { unique: true, name: "project_github_repository_unique" });
githubRepositoryLinkSchema.index({ installationId: 1, repositoryId: 1, active: 1 }, { name: "github_webhook_repository_lookup" });
githubRepositoryLinkSchema.index({ projectId: 1, active: 1, fullName: 1 }, { name: "project_github_repositories" });
export const GitHubRepositoryLink = mongoose.model("GitHubRepositoryLink", githubRepositoryLinkSchema);
