import dotenv from "dotenv";
import mongoose from "mongoose";
import { User } from "../src/models/user.model.js";
import { Project } from "../src/models/project.model.js";
import { resolveProjectRole } from "../src/utils/projectRole.js";
import { buildAccessibleProjectsFilter } from "../src/utils/projectAccessPolicy.js";

dotenv.config();
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is required. Configure backend/.env first.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const users = await User.find().select("_id name projectId defaultProjectId role");
  let repairedDefaults = 0;
  let createdFallbackProjects = 0;

  for (const user of users) {
    const preferredId = user.defaultProjectId || user.projectId;
    let project = preferredId
      ? await Project.findOne({
        _id: preferredId,
        archivedAt: null,
        $or: [{ ownerId: user._id }, { "members.userId": user._id }],
      })
      : null;

    if (!project) {
      project = await Project.findOne(buildAccessibleProjectsFilter(user._id)).sort({ createdAt: 1 });
    }
    if (!project) {
      project = await Project.create({ ownerId: user._id, name: `${user.name || "User"}'s project` });
      createdFallbackProjects += 1;
    }

    const role = resolveProjectRole(project, user._id);
    if (!role) throw new Error(`Cannot resolve membership role for user ${user._id} in project ${project._id}`);

    if (String(user.defaultProjectId || "") !== String(project._id) || String(user.projectId || "") !== String(project._id)) {
      await User.updateOne({ _id: user._id }, { $set: { defaultProjectId: project._id, projectId: project._id } });
      repairedDefaults += 1;
    }
  }

  const projectCollection = mongoose.connection.collection(Project.collection.name);
  const indexes = await projectCollection.indexes();
  if (indexes.some((index) => index.name === "project_owner_unique")) {
    await projectCollection.dropIndex("project_owner_unique");
    console.log("Dropped legacy unique owner index: project_owner_unique");
  }
  await projectCollection.createIndex({ ownerId: 1, createdAt: -1 }, { name: "owner_createdAt" });
  await User.collection.createIndex({ defaultProjectId: 1 }, { name: "defaultProjectId_1" });

  console.log("Multi-project migration completed.");
  console.log(`Users checked: ${users.length}`);
  console.log(`Default project references repaired: ${repairedDefaults}`);
  console.log(`Fallback projects created: ${createdFallbackProjects}`);
  console.log("Users can now own multiple projects and join multiple projects. Existing projectId values remain as compatibility defaults.");
} catch (error) {
  console.error("Multi-project migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
