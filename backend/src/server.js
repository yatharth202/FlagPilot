import dotenv from "dotenv";
import { parseTrustProxy } from "./utils/trustProxy.js";
import { parseFrontendOrigins, validateRefreshCookieSameSite, validateMetricsToken } from "./utils/deploymentPolicy.js";
import { getInvitationTtlMs } from "./utils/projectInvitationPolicy.js";
import { isInvitationEmailConfigured } from "./services/invitationEmail.service.js";
import { validateGoogleOAuthConfiguration } from "./services/googleOAuth.service.js";
dotenv.config();

const requiredEnv = ["MONGODB_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const weakSecrets = ["JWT_SECRET", "JWT_REFRESH_SECRET"].filter((name) => {
  const value = process.env[name];
  return value.length < 32 || /replace-with|change-me|your[-_ ]|placeholder|example-secret/i.test(value);
});
if (weakSecrets.length || process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
  console.error("JWT_SECRET and JWT_REFRESH_SECRET must be different, generated random values of at least 32 characters. Do not leave example placeholders in backend/.env.");
  process.exit(1);
}

const rolloutMaxStep = Number(process.env.PROD_ROLLOUT_MAX_STEP || 25);
const rolloutCooldownMs = Number(process.env.PROD_ROLLOUT_COOLDOWN_MS || 900000);
if (!Number.isFinite(rolloutMaxStep) || rolloutMaxStep < 1 || rolloutMaxStep > 50 || !Number.isFinite(rolloutCooldownMs) || rolloutCooldownMs < 0 || rolloutCooldownMs > 86_400_000) {
  console.error("PROD_ROLLOUT_MAX_STEP must be 1-50 and PROD_ROLLOUT_COOLDOWN_MS must be 0-86400000.");
  process.exit(1);
}

try {
  parseTrustProxy(process.env.TRUST_PROXY, { production: process.env.NODE_ENV === "production" });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

try {
  validateRefreshCookieSameSite(process.env.REFRESH_COOKIE_SAME_SITE, { production: process.env.NODE_ENV === "production" });
  if (process.env.FRONTEND_ORIGIN) parseFrontendOrigins(process.env.FRONTEND_ORIGIN, { production: process.env.NODE_ENV === "production" });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

try {
  validateMetricsToken(process.env.METRICS_TOKEN);
  getInvitationTtlMs(process.env.INVITATION_TTL_HOURS);
  validateGoogleOAuthConfiguration(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  const productionMissing = ["REDIS_URL", "FRONTEND_ORIGIN", "TRUST_PROXY", "RESEND_API_KEY", "EMAIL_FROM"].filter((name) => !process.env[name]?.trim());
  if (productionMissing.length) {
    console.error(`Production requires shared rate limiting, an explicit CORS allow-list, explicit proxy trust configuration, and invitation email provider settings: ${productionMissing.join(", ")}`);
    process.exit(1);
  }
}

const { default: app } = await import("./app.js");
const { default: connectDB } = await import("./config/db.js");
const { getRedisClient, closeRedisClient } = await import("./utils/redisClient.js");
const mongoose = (await import("mongoose")).default;

try {
  await connectDB();
  if (process.env.NODE_ENV === "production") {
    const topologyType = mongoose.connection.client?.topology?.description?.type;
    if (!["ReplicaSetWithPrimary", "Sharded"].includes(topologyType)) {
      throw new Error(`Production requires a MongoDB replica set or sharded cluster for atomic audit/configuration writes (detected: ${topologyType || "unknown"})`);
    }
    await getRedisClient();
  }

  const port = Number(process.env.PORT) || 8000;
  const server = app.listen(port, () => console.log(`Feature Flag API listening on port ${port}`));
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down FlagPilot API`);
    server.close(async () => {
      try {
        await closeRedisClient();
        await mongoose.disconnect();
        process.exit(0);
      } catch (error) {
        console.error("Graceful shutdown failed:", error.message);
        process.exit(1);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
} catch (error) {
  console.error("Server failed to start:", { name: error?.name, code: error?.code });
  process.exit(1);
}
