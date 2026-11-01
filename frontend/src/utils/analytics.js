import API from "../api/axios.js";

const createEventId = () => globalThis.crypto?.randomUUID?.()
  || `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;


export const trackDemoEvent = ({ userId, flagKey, variant = "control", environment = "dev", event = "exposure", metadata = {} }) => {
  const stableUserId = typeof userId === "string" ? userId.trim() : "";
  if (!stableUserId) throw new Error("A stable user ID is required to track analytics");
  return API.post("/analytics/track", {
    userId: stableUserId,
    eventId: createEventId(),
    flagKey,
    variant,
    environment,
    event,
    metadata,
  });
};
