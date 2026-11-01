import mongoose from "mongoose";

/** Public readiness endpoint: expose state, not dependency diagnostics. */
export const healthCheck = (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  if (!connected) {
    return res.status(503).json({ status: "unavailable" });
  }
  return res.status(200).json({ status: "ok" });
};
