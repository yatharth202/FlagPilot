import dotenv from "dotenv";
import mongoose from "mongoose";
import { User } from "../src/models/user.model.js";
import { Project } from "../src/models/project.model.js";
import { FeatureFlag } from "../src/models/featureFlag.model.js";
import { Analytics } from "../src/models/analytics.model.js";
import { AuditLog } from "../src/models/auditLog.model.js";

dotenv.config();
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is required. Configure backend/.env first.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });

  const users = await User.find().sort({ createdAt: 1 });
  if (!users.length) {
    console.log("No users found. New registrations create an isolated project automatically.");
    process.exitCode = 0;
  } else {
    // Existing unscoped data belongs to the earliest existing admin if one
    // exists, otherwise the oldest account. This preserves legacy data without
    // exposing it to newly registered accounts.
    // On first migration the legacy data has no projectId and belongs to the
    // earliest prior administrator (or oldest account). On reruns, prefer a
    // current project owner so existing team members are not detached.
    let primaryOwner = users.find((user) => user.role === "admin") || users[0];
    for (const user of users) {
      const ownedProject = await Project.findOne({ ownerId: user._id });
      if (ownedProject) { primaryOwner = user; break; }
    }
    const projectsByUser = new Map();

    for (const user of users) {
      const preferredProjectId = user.defaultProjectId || user.projectId;
      let project = preferredProjectId ? await Project.findOne({
        _id: preferredProjectId,
        $or: [{ ownerId: user._id }, { "members.userId": user._id }],
      }) : null;
      if (!project) project = await Project.findOne({ ownerId: user._id });
      if (!project) project = await Project.create({ ownerId: user._id, name: `${user.name || "User"}'s project` });

      user.projectId = project._id; // preserve legacy default alias
      user.defaultProjectId = project._id;
      const isOwner = String(project.ownerId) === String(user._id);
      const membership = project.members.find((entry) => String(entry.userId) === String(user._id));
      user.role = isOwner ? "owner" : (membership?.role || "viewer");
      user.refreshToken = undefined; // old versions stored refresh JWTs in plaintext; force a clean login
      await user.save({ validateBeforeSave: false });
      projectsByUser.set(String(user._id), project);
    }

    const primaryProject = projectsByUser.get(String(primaryOwner._id));
    const flagCollection = mongoose.connection.collection(FeatureFlag.collection.name);
    const analyticsCollection = mongoose.connection.collection(Analytics.collection.name);
    const auditCollection = mongoose.connection.collection(AuditLog.collection.name);

    const legacyFlagFilter = { $or: [{ projectId: { $exists: false } }, { projectId: null }] };
    const legacyFlagCount = await flagCollection.countDocuments(legacyFlagFilter);
    if (legacyFlagCount) {
      await flagCollection.updateMany(legacyFlagFilter, { $set: { projectId: primaryProject._id } });
    }

    const legacyAnalyticsFilter = { $or: [{ projectId: { $exists: false } }, { projectId: null }] };
    const legacyAnalyticsCount = await analyticsCollection.countDocuments(legacyAnalyticsFilter);
    if (legacyAnalyticsCount) {
      await analyticsCollection.updateMany(legacyAnalyticsFilter, { $set: { projectId: primaryProject._id } });
    }

    const legacyAuditFilter = { $or: [{ projectId: { $exists: false } }, { projectId: null }] };
    const legacyAudits = await auditCollection.find(legacyAuditFilter).toArray();
    for (const entry of legacyAudits) {
      const flag = await flagCollection.findOne({ _id: entry.flagId }, { projection: { projectId: 1 } });
      await auditCollection.updateOne({ _id: entry._id }, { $set: { projectId: flag?.projectId || primaryProject._id } });
    }

    await flagCollection.updateMany({ environment: { $exists: false } }, { $set: { environment: "prod" } });

    // Remove the previous global key/environment uniqueness constraint only
    // after records are scoped. Same flag keys can now exist across projects.
    const indexes = await flagCollection.indexes();
    if (indexes.some((index) => index.name === "key_1_environment_1")) await flagCollection.dropIndex("key_1_environment_1");
    if (indexes.some((index) => index.name === "key_1" && index.unique)) await flagCollection.dropIndex("key_1");
    await flagCollection.createIndex({ projectId: 1, key: 1, environment: 1 }, { unique: true, name: "project_key_environment_unique" });
    await flagCollection.createIndex({ projectId: 1, environment: 1, updatedAt: -1 }, { name: "project_environment_updatedAt" });
    await analyticsCollection.createIndex({ projectId: 1, flagKey: 1, environment: 1, createdAt: -1 }, { name: "project_flag_env_createdAt" });
    await auditCollection.createIndex({ projectId: 1, flagId: 1, createdAt: -1 }, { name: "project_flag_createdAt" });
    const projectCollection = mongoose.connection.collection(Project.collection.name);
    // A user may now own multiple projects. Remove the legacy unique index.
    const projectIndexes = await projectCollection.indexes();
    if (projectIndexes.some((index) => index.name === "project_owner_unique")) {
      await projectCollection.dropIndex("project_owner_unique");
    }
    await projectCollection.createIndex({ ownerId: 1, createdAt: -1 }, { name: "owner_createdAt" });
    await projectCollection.createIndex({ devClientKey: 1 }, { unique: true, name: "devClientKey_1" });
    await projectCollection.createIndex({ prodClientKey: 1 }, { unique: true, name: "prodClientKey_1" });

    console.log("Tenant-scope migration completed.");
    console.log(`Existing unscoped flags assigned to primary project: ${legacyFlagCount}`);
    console.log(`Existing unscoped analytics events assigned to primary project: ${legacyAnalyticsCount}`);
    console.log(`Existing audit entries scoped: ${legacyAudits.length}`);
    console.log(`Projects prepared for accounts: ${users.length}`);
  }
} catch (error) {
  console.error("Tenant-scope migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
