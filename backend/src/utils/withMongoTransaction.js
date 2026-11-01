import mongoose from "mongoose";
import { ApiError } from "./ApiError.js";
import { getTransactionMode } from "./transactionPolicy.js";


export const withMongoTransaction = async (work) => {
  const topologyType = mongoose.connection.client?.topology?.description?.type;
  const mode = getTransactionMode({
    topologyType,
    nodeEnv: process.env.NODE_ENV,
    allowNonTransactionalDev: process.env.MONGODB_ALLOW_NON_TRANSACTIONAL_DEV === "true",
  });

  if (mode === "unavailable") {
    throw new ApiError(503, "Atomic audited writes require MongoDB replica-set or sharded topology. Configure a replica set; non-transactional development fallback is disabled.");
  }
  if (mode === "non_atomic_development") {
    console.warn("WARNING: MONGODB_ALLOW_NON_TRANSACTIONAL_DEV=true; writes are NOT atomic. Never use this mode for client or production data.");
    return work(null);
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    }, {
      readPreference: "primary",
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export const inSession = (query, session) => session ? query.session(session) : query;
export const createInSession = async (Model, document, session) => {
  const [created] = await Model.create([document], session ? { session } : undefined);
  return created;
};
