import mongoose from "mongoose";

const githubWebhookDeliverySchema = new mongoose.Schema({
  deliveryId: { type: String, required: true, unique: true, immutable: true, maxlength: 100 },
  eventName: { type: String, required: true, immutable: true, maxlength: 80 },
  action: { type: String, default: null, immutable: true, maxlength: 80 },
  installationId: { type: Number, default: null, immutable: true },
  repositoryId: { type: Number, default: null, immutable: true },
  outcome: { type: String, enum: ["processed", "ignored"], required: true, immutable: true },
  receivedAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false });

githubWebhookDeliverySchema.index({ receivedAt: 1 }, { expireAfterSeconds: 7776000, name: "github_webhook_delivery_retention" });
export const GitHubWebhookDelivery = mongoose.model("GitHubWebhookDelivery", githubWebhookDeliverySchema);
