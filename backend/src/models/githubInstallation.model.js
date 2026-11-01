import mongoose from "mongoose";

const githubInstallationSchema = new mongoose.Schema({
  installationId: { type: Number, required: true, unique: true, immutable: true },
  accountId: { type: Number, required: true },
  accountLogin: { type: String, required: true, trim: true, maxlength: 100 },
  accountType: { type: String, enum: ["User", "Organization", "Bot"], required: true },
  targetType: { type: String, enum: ["user", "organization"], default: "user" },
  suspendedAt: { type: Date, default: null },
  lastSyncedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

export const GitHubInstallation = mongoose.model("GitHubInstallation", githubInstallationSchema);
