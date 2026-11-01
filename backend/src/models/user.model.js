import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true
    },

    password: {
      type: String,
      required: false,
      select: false
    },

    googleId: {
      type: String,
      trim: true,
      maxlength: 255,
    },

    role: {
      type: String,
      enum: ["owner", "admin", "developer", "viewer"],
      default: "viewer"
    },
    

    authVersion: {
      type: Number,
      default: 0,
      min: 0,
    },

    refreshToken:{
      type: String,
      select: false,
    },


    defaultProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
      index: true,
    },

    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
      index: true,
    }
  },
  { timestamps: true }
);

userSchema.index({ googleId: 1 }, { unique: true, sparse: true, name: "google_id_unique" });


userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});


userSchema.methods.comparePassword = async function (enteredPassword) {
  if (typeof this.password !== "string" || !this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

export const User = mongoose.model("User", userSchema);