import mongoose from "mongoose";

const featureFlagSchema = new mongoose.Schema(
    {
        projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },

        name: {
            type: String,
            required: true,
            trim: true
        },

        key: {
            type: String,
            required: true,
            trim: true,
            lowercase: true
        },


        description: {
            type: String,
            default:"",
        },

        type: {
            type: String,
            enum: ["boolean", "string", "number", "json"],
            default: "boolean"
        },

        enabled: {
             type: Boolean,
             default: false,
        },

        value: {
            type: mongoose.Schema.Types.Mixed,
            default: true
        },

        defaultValue: {
            type: mongoose.Schema.Types.Mixed,
            default: false
        },

        targeting: {
            explicit:{
                    roles:{
                        type: [String],
                        default: []
                    },
                    userIds: {
                        type: [String],
                        default: []
                    }
        },

        rules:[
            {
            field:{
                type: String,
                required: true
            },
            operator:{
                type: String,
                enum: ["equals"],
                default: "equals"
            },
            value:{
                type: String
            }
            }
        ]
        },

        rolloutPercentage: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },

        // Operational rollout state is stored with the flag rather than
        // inferred only from audit history. MongoDB transactions serialize
        // concurrent updates to this document in replica-set deployments.
        lastRolloutIncreaseAt: { type: Date, default: null },
        lastRolloutIncreaseFrom: { type: Number, default: null, min: 0, max: 100 },
        lastRolloutIncreaseTo: { type: Number, default: null, min: 0, max: 100 },

        environment: {
            type: String,
            enum: ["dev","prod"],
            default: "prod",
        }
    },
    { timestamps: true, optimisticConcurrency: true }
)

featureFlagSchema.index({ projectId: 1, key: 1, environment: 1 }, { unique: true, name: "project_key_environment_unique" });
featureFlagSchema.index({ projectId: 1, environment: 1, updatedAt: -1 }, { name: "project_environment_updatedAt" });

export const FeatureFlag = mongoose.model("FeatureFlag",featureFlagSchema)