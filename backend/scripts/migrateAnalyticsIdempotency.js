import dotenv from "dotenv";
import mongoose from "mongoose";
import { Analytics } from "../src/models/analytics.model.js";
import { createAnalyticsFingerprint } from "../src/utils/analyticsIntegrity.js";

dotenv.config();
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is required. Configure backend/.env first.");
  process.exit(1);
}

const legacyIdFor = (prefix, id) => `${prefix}_${String(id)}`;

try {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const collection = mongoose.connection.collection(Analytics.collection.name);

  await collection.updateMany({ environment: { $exists: false } }, { $set: { environment: "prod" } });
  await collection.updateMany({ event: { $exists: false } }, { $set: { event: "exposure" } });

  // Give pre-idempotency rows deterministic IDs before creating the unique
  // index. This migration is repeatable and never deletes historical rows.
  const rowsWithoutEventId = collection.find({ $or: [{ eventId: { $exists: false } }, { eventId: null }, { eventId: "" }] }, { projection: { _id: 1 } });
  for await (const item of rowsWithoutEventId) {
    await collection.updateOne(
      { _id: item._id, $or: [{ eventId: { $exists: false } }, { eventId: null }, { eventId: "" }] },
      { $set: { eventId: legacyIdFor("legacy", item._id) } },
    );
  }

  // Legacy pseudo-identities cannot be treated as one real user. Preserve the
  // rows for inspection but exclude them from current metrics and event logs.
  const anonymousResult = await collection.updateMany(
    {
      $or: [
        { userId: { $in: ["anonymous", "anon", ""] } },
        { userId: { $exists: false } },
        { userId: null },
      ],
      deduplicatedAt: null,
    },
    { $set: { deduplicatedAt: new Date() } },
  );

  // Backfill canonical payload hashes so retries can be distinguished from
  // accidental eventId reuse with different event contents.
  const missingHashes = collection.find({ $or: [{ payloadHash: { $exists: false } }, { payloadHash: null }, { payloadHash: "" }] });
  for await (const item of missingHashes) {
    const payloadHash = createAnalyticsFingerprint(item);
    await collection.updateOne({ _id: item._id }, { $set: { payloadHash } });
  }

  // Resolve historic eventId collisions before creating the unique index.
  // Identical fingerprints are duplicate deliveries; conflicting payloads are
  // preserved as separate legacy events with synthetic IDs rather than lost.
  let duplicateDeliveries = 0;
  let conflictingIdReuse = 0;
  const duplicateIdGroups = collection.aggregate([
    { $match: { eventId: { $type: "string" } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: { _id: { projectId: "$projectId", eventId: "$eventId" }, rows: { $push: { _id: "$_id", payloadHash: "$payloadHash" } } } },
    { $match: { "rows.1": { $exists: true } } },
  ], { allowDiskUse: true });
  for await (const group of duplicateIdGroups) {
    const [first, ...duplicates] = group.rows;
    for (const duplicate of duplicates) {
      const samePayload = duplicate.payloadHash && duplicate.payloadHash === first.payloadHash;
      const syntheticId = legacyIdFor(samePayload ? "legacy_duplicate" : "legacy_conflict", duplicate._id);
      const update = { eventId: syntheticId };
      if (samePayload) {
        update.deduplicatedAt = new Date();
        duplicateDeliveries += 1;
      } else {
        conflictingIdReuse += 1;
      }
      await collection.updateOne({ _id: duplicate._id }, { $set: update });
    }
  }

  // Preserve one earliest exposure per project/flag/environment/user. Later
  // duplicate deliveries remain in MongoDB but are excluded from analytics.
  let duplicateExposures = 0;
  const exposureGroups = collection.aggregate([
    { $match: { event: "exposure", deduplicatedAt: null } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: { _id: { projectId: "$projectId", flagKey: "$flagKey", environment: "$environment", userId: "$userId" }, ids: { $push: "$_id" } } },
    { $match: { "ids.1": { $exists: true } } },
  ], { allowDiskUse: true });
  for await (const group of exposureGroups) {
    const duplicates = group.ids.slice(1);
    const result = await collection.updateMany(
      { _id: { $in: duplicates } },
      { $set: { deduplicatedAt: new Date() } },
    );
    duplicateExposures += result.modifiedCount || 0;
  }

  // Historical versions could accept conversions without an exposure or keep
  // the variant supplied by the browser. Reconcile those rows to the active
  // exposure: orphan conversions are excluded, and valid conversions inherit
  // the server-attributed first-exposure variant.
  let orphanConversions = 0;
  let reattributedConversions = 0;
  const conversions = collection.aggregate([
    { $match: { event: "conversion", deduplicatedAt: null } },
    {
      $lookup: {
        from: Analytics.collection.name,
        let: { projectId: "$projectId", flagKey: "$flagKey", environment: "$environment", userId: "$userId" },
        pipeline: [
          {
            $match: {
              event: "exposure",
              deduplicatedAt: null,
              $expr: {
                $and: [
                  { $eq: ["$projectId", "$$projectId"] },
                  { $eq: ["$flagKey", "$$flagKey"] },
                  { $eq: ["$environment", "$$environment"] },
                  { $eq: ["$userId", "$$userId"] },
                ],
              },
            },
          },
          { $sort: { createdAt: 1, _id: 1 } },
          { $project: { _id: 0, variant: { $ifNull: ["$variant", "control"] } } },
          { $limit: 1 },
        ],
        as: "sourceExposure",
      },
    },
    { $project: { _id: 1, variant: 1, sourceVariant: { $arrayElemAt: ["$sourceExposure.variant", 0] } } },
  ], { allowDiskUse: true });
  for await (const conversion of conversions) {
    if (typeof conversion.sourceVariant !== "string") {
      await collection.updateOne({ _id: conversion._id }, { $set: { deduplicatedAt: new Date() } });
      orphanConversions += 1;
    } else if ((conversion.variant || "control") !== conversion.sourceVariant) {
      await collection.updateOne({ _id: conversion._id }, { $set: { variant: conversion.sourceVariant } });
      reattributedConversions += 1;
    }
  }

  await collection.createIndex(
    { projectId: 1, eventId: 1 },
    { unique: true, name: "project_event_id_unique", partialFilterExpression: { eventId: { $type: "string" } } },
  );
  await collection.createIndex(
    { projectId: 1, flagKey: 1, environment: 1, userId: 1 },
    { unique: true, name: "project_flag_env_user_exposure_unique", partialFilterExpression: { event: "exposure", deduplicatedAt: null } },
  );
  await collection.createIndex(
    { projectId: 1, flagKey: 1, environment: 1, createdAt: -1 },
    { name: "project_flag_env_createdAt" },
  );
  await collection.createIndex(
    { projectId: 1, environment: 1, createdAt: -1, _id: -1 },
    { name: "project_env_event_log" },
  );

  console.log("Analytics idempotency migration completed.");
  console.log(`Identical historic eventId deliveries excluded: ${duplicateDeliveries}`);
  console.log(`Conflicting historic eventId reuse preserved under synthetic IDs: ${conflictingIdReuse}`);
  console.log(`Duplicate historic exposures excluded: ${duplicateExposures}`);
  console.log(`Historic conversions without a matching exposure excluded: ${orphanConversions}`);
  console.log(`Historic conversions attributed to their recorded exposure: ${reattributedConversions}`);
  console.log(`Legacy pseudo-anonymous or unidentifiable events excluded: ${anonymousResult.modifiedCount || 0}`);
} catch (error) {
  console.error("Analytics idempotency migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
