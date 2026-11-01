import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is required. Add it to backend/.env before running this migration.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const collection = mongoose.connection.collection("featureflags");
  const duplicatePairs = await collection.aggregate([
    { $group: { _id: { key: "$key", environment: { $ifNull: ["$environment", "prod"] } }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  if (duplicatePairs.length) {
    console.error("Migration stopped: duplicate (key, environment) pairs exist:");
    for (const pair of duplicatePairs) console.error(JSON.stringify(pair));
    process.exitCode = 1;
  } else {
    // Create the safer compound index before removing the old unique key-only
    // index, so an interruption never leaves the collection unprotected.
    await collection.createIndex({ key: 1, environment: 1 }, { unique: true, name: "key_1_environment_1" });
    const indexes = await collection.indexes();
    const oldGlobalKeyIndex = indexes.find((index) => index.name === "key_1" && index.unique);
    if (oldGlobalKeyIndex) {
      await collection.dropIndex("key_1");
      console.log("Dropped the old globally unique key index.");
    }
    await collection.updateMany({ environment: { $exists: false } }, { $set: { environment: "prod" } });
    console.log("Created compound unique index on (key, environment) and normalized missing environments to prod.");
  }
} catch (error) {
  console.error("Environment index migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
