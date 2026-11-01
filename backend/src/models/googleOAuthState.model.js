import mongoose from "mongoose";

const googleOAuthStateSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true, immutable: true, select: false },
  nonceHash: { type: String, required: true, immutable: true, select: false },
  codeVerifier: { type: String, required: true, immutable: true, select: false },
  returnTo: { type: String, required: true, immutable: true, maxlength: 2048 },
  expiresAt: { type: Date, required: true, immutable: true },
}, { timestamps: true, versionKey: false });

googleOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "google_oauth_state_ttl" });

export const GoogleOAuthState = mongoose.model("GoogleOAuthState", googleOAuthStateSchema);
