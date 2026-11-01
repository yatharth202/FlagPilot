import mongoose from "mongoose";

const analyticsSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    userId: { type: String, required: true, maxlength: 200 },
    eventId: { type: String, required: true, maxlength: 128 },
    payloadHash: { type: String, match: /^[a-f0-9]{64}$/ },
    deduplicatedAt: { type: Date, default: null, select: false },
    flagKey: { type: String, required: true, lowercase: true, trim: true, maxlength: 100 },
    environment: { type: String, enum: ["dev", "prod"], default: "prod", index: true },
    variant: { type: String, default: "control" },

    event: {
      type: String,
      enum: ["exposure", "conversion"],
      default: "exposure",
    },

    metadata: {
      type: Object,
      default: {},
    },
    createdAt: {
     type: Date,
     default: Date.now,
    }
  },
  { timestamps: true }
);

analyticsSchema.index({ projectId: 1, eventId: 1 }, { unique: true, name: "project_event_id_unique", partialFilterExpression: { eventId: { $type: "string" } } });
analyticsSchema.index(
  { projectId: 1, flagKey: 1, environment: 1, userId: 1 },
  { unique: true, name: "project_flag_env_user_exposure_unique", partialFilterExpression: { event: "exposure", deduplicatedAt: null } },
);
analyticsSchema.index({ projectId: 1, flagKey: 1, environment: 1, createdAt: -1 }, { name: "project_flag_env_createdAt" });
analyticsSchema.index({ projectId: 1, environment: 1, createdAt: -1, _id: -1 }, { name: "project_env_event_log" });

export const Analytics = mongoose.model("Analytics", analyticsSchema);