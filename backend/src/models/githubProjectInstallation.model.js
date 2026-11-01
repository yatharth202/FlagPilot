import mongoose from "mongoose";

const githubProjectInstallationSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, immutable: true },
  installationId: { type: Number, required: true, immutable: true },
  connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  connectedAt: { type: Date, default: Date.now, required: true },
  disconnectedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

githubProjectInstallationSchema.index({ projectId: 1, installationId: 1 }, { unique: true, name: "project_github_installation_unique" });
githubProjectInstallationSchema.index({ projectId: 1, disconnectedAt: 1, createdAt: -1 }, { name: "project_github_installations" });
export const GitHubProjectInstallation = mongoose.model("GitHubProjectInstallation", githubProjectInstallationSchema);
