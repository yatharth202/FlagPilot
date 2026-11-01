/** Pure policy helper so the standalone-MongoDB behavior can be unit tested. */
export const getTransactionMode = ({ topologyType, nodeEnv, allowNonTransactionalDev }) => {
  if (topologyType !== "Single") return "transaction";
  if (nodeEnv === "development" && allowNonTransactionalDev === true) return "non_atomic_development";
  return "unavailable";
};
