
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI is missing from backend/.env");
  process.exit(1);
}

const COLLECTION_NAME = "featureflags";
const LEGACY_INDEX_NAME = "name_1";
const EXPECTED_PROJECT_INDEX = "project_key_environment_unique";

try {
  console.log("Connecting to MongoDB...");

  await mongoose.connect(MONGODB_URI, {
    autoIndex: false,
  });

  console.log("Connected successfully.");

  const collection = mongoose.connection.db.collection(COLLECTION_NAME);

  // Read existing indexes. This script does not modify documents.
  const indexes = await collection.indexes();

  console.log("\nCurrent feature flag indexes:");

  for (const index of indexes) {
    console.log({
      name: index.name,
      key: index.key,
      unique: index.unique === true,
    });
  }

  // Verify that the correct project-scoped index exists first.
  const projectIndex = indexes.find(
    (index) => index.name === EXPECTED_PROJECT_INDEX
  );

  const correctProjectIndex =
    projectIndex &&
    projectIndex.unique === true &&
    JSON.stringify(Object.entries(projectIndex.key)) ===
      JSON.stringify([
        ["projectId", 1],
        ["key", 1],
        ["environment", 1],
      ]);

  if (!correctProjectIndex) {
    throw new Error(
      "Expected project-scoped unique index is missing or incorrect. Aborting without dropping anything."
    );
  }

  console.log("\nProject-scoped unique index verified.");

  // Locate the obsolete globally unique name index.
  const legacyIndex = indexes.find(
    (index) => index.name === LEGACY_INDEX_NAME
  );

  if (!legacyIndex) {
    console.log(
      "Legacy name_1 index is already absent. No changes required."
    );
  } else {
    // Only drop the exact known obsolete index.
    const entries = Object.entries(legacyIndex.key || {});

    const isExpectedLegacyIndex =
      legacyIndex.unique === true &&
      entries.length === 1 &&
      entries[0][0] === "name" &&
      entries[0][1] === 1 &&
      !legacyIndex.partialFilterExpression;

    if (!isExpectedLegacyIndex) {
      throw new Error(
        "The name_1 index has an unexpected definition. Refusing to drop it."
      );
    }

    console.log("\nFound obsolete global unique name index.");
    console.log("Dropping only name_1...");

    await collection.dropIndex(LEGACY_INDEX_NAME);

    console.log("Legacy name_1 index dropped.");
  }

  // Verify final database state.
  const finalIndexes = await collection.indexes();

  const stillExists = finalIndexes.some(
    (index) => index.name === LEGACY_INDEX_NAME
  );

  const finalProjectIndex = finalIndexes.find(
    (index) => index.name === EXPECTED_PROJECT_INDEX
  );

  if (stillExists) {
    throw new Error("Legacy name_1 index still exists.");
  }

  if (
    !finalProjectIndex ||
    finalProjectIndex.unique !== true
  ) {
    throw new Error(
      "Project-scoped unique index verification failed."
    );
  }

  console.log("MIGRATION COMPLETED SUCCESSFULLY");
  console.log("Obsolete global name uniqueness: REMOVED");
  console.log("Project-scoped uniqueness: VERIFIED");
  console.log("Existing documents modified: 0");
  console.log("Existing documents deleted: 0");

} catch (error) {
  console.error("\nMIGRATION FAILED:");
  console.error(error.message);

  process.exitCode = 1;

} finally {
  await mongoose.disconnect();
  console.log("\nMongoDB connection closed.");
}
