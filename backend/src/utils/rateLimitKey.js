import { createHash } from "node:crypto";


export const buildRateLimitKey = (namespace, identity) => {
  const safeNamespace = String(namespace || "requests").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 48) || "requests";
  const safeIdentity = String(identity || "unknown");
  const digest = createHash("sha256").update(`${safeNamespace}:${safeIdentity}`).digest("hex");
  return { namespace: safeNamespace, digest, key: `flagpilot:rate-limit:${safeNamespace}:${digest}` };
};
