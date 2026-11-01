import mongoose from "mongoose";

const githubInstallStateSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true, immutable: true, select: false },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, immutable: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  flowStep: { type: String, enum: ["install", "oauth"], default: "install", required: true, immutable: true },
  installationId: { type: Number, default: null, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
  consumedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

githubInstallStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "github_install_state_ttl" });
export const GitHubInstallState = mongoose.model("GitHubInstallState", githubInstallStateSchema);
