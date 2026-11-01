import mongoose from "mongoose";
import { randomBytes } from "node:crypto";

const makeClientKey = (environment) => `fp_${environment}_${randomBytes(24).toString("base64url")}`;

const projectSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true, trim: true, maxlength: 100, default: "My project" },
  archivedAt: { type: Date, default: null, index: true },

  devClientKey: { type: String, required: true, unique: true, default: () => makeClientKey("dev") },
  prodClientKey: { type: String, required: true, unique: true, default: () => makeClientKey("prod") },
  members: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["admin", "developer", "viewer"], required: true, default: "developer" },
    addedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true, optimisticConcurrency: true });

projectSchema.index({ ownerId: 1, createdAt: -1 }, { name: "owner_createdAt" });
projectSchema.index({ "members.userId": 1, archivedAt: 1, updatedAt: -1 }, { name: "member_archived_updatedAt" });
projectSchema.methods.getClientKey = function (environment) {
  return environment === "dev" ? this.devClientKey : this.prodClientKey;
};

export const Project = mongoose.model("Project", projectSchema);
export { makeClientKey };
