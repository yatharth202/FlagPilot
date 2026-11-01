import dotenv from "dotenv";
import mongoose from "mongoose";
import { AuditLog } from "../src/models/auditLog.model.js";

dotenv.config();
const migrationUri = process.env.MONGODB_MIGRATION_URI || process.env.MONGODB_URI;
if (!migrationUri) {
  console.error("MONGODB_MIGRATION_URI (or MONGODB_URI) is required. Configure backend/.env first.");
  process.exit(1);
}

const isObjectId = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

try {
  await mongoose.connect(migrationUri, { autoIndex: false });
  const cursor = AuditLog.collection.find({});
  let migrated = 0;
  for await (const row of cursor) {
    const set = {};
    if (!row.entityType) set.entityType = "feature_flag";
    if (!row.entityId && row.flagId) set.entityId = row.flagId;
    if (!row.actorType) set.actorType = isObjectId(row.changedBy) ? "user" : "legacy";
    if (!row.actorId && isObjectId(row.changedBy)) set.actorId = new mongoose.Types.ObjectId(row.changedBy);
    if (!row.actorRole) set.actorRole = "unknown";
    if (!Object.prototype.hasOwnProperty.call(row, "requestId")) set.requestId = null;
    if (Object.keys(set).length) {
      await AuditLog.collection.updateOne({ _id: row._id }, { $set: set });
      migrated += 1;
    }
  }
  await AuditLog.collection.createIndex(
    { projectId: 1, entityType: 1, entityId: 1, createdAt: -1 },
    { name: "project_entity_createdAt" },
  );
  console.log(`Audit-log migration complete. Updated ${migrated} legacy record(s).`);
} catch (error) {
  console.error("Audit-log migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
