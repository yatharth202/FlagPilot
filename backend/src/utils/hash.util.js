import crypto from "node:crypto";


export const getUserRolloutBucket = (userId, flagKey) => {
  const hash = crypto
    .createHash("sha256")
    .update(`${userId}:${flagKey}`)
    .digest("hex");
  return parseInt(hash.substring(0, 8), 16) % 100;
};
