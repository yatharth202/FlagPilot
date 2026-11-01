import express from "express";
import cors from "cors";
import featureFlagRoutes from "./routes/featureFlag.routes.js";
import authRoutes from "./routes/auth.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import projectRoutes from "./routes/project.routes.js";
import approvalRoutes from "./routes/approval.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import invitationRoutes from "./routes/invitation.routes.js";
import githubRoutes from "./routes/github.routes.js";
import githubWebhookRoutes from "./routes/githubWebhook.routes.js";
import { ApiError } from "./utils/ApiError.js";
import { healthCheck } from "./controllers/health.controller.js";
import cache from "./utils/memoryCache.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { parseTrustProxy } from "./utils/trustProxy.js";
import { parseFrontendOrigins } from "./utils/deploymentPolicy.js";
import { createRateLimit } from "./utils/rateLimit.js";

const app = express();
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY, { production: process.env.NODE_ENV === "production" }));
app.set("query parser", "simple");

const configuredOrigins = parseFrontendOrigins(process.env.FRONTEND_ORIGIN, { production: process.env.NODE_ENV === "production" });



app.disable("x-powered-by");
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
});
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(cors({
  origin(origin, callback) {

    if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
    return callback(new ApiError(403, "Origin is not allowed by CORS"));
  },
  credentials: true,
}));

app.use("/api/v1/github/webhooks", express.raw({ type: "application/json", limit: "1mb" }), githubWebhookRoutes);

app.use(express.json({ limit: "1mb", strict: true, type: ["application/json", "application/*+json"] }));

app.get("/", (req, res) => res.status(200).json({ success: true, message: "Feature Flag API is running" }));
app.get("/health", healthCheck);


app.get("/metrics", createRateLimit({ windowMs: 60_000, max: 30, message: "Metrics rate limit exceeded" }), async (req, res) => {
  const expected = process.env.METRICS_TOKEN || "";
  const authorization = String(req.get("authorization") || "");
  const match = /^Bearer ([^\s]{32,512})$/.exec(authorization);
  const suppliedBuffer = Buffer.from(match?.[1] || "");
  const expectedBuffer = Buffer.from(expected);
  const authorized = expectedBuffer.length >= 32 && expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
  if (!authorized) return res.status(404).json({ success: false, message: "Not found" });
  return res.status(200).json({
    success: true,
    cache: await cache.getMetrics(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1", createRateLimit({ windowMs: 60_000, max: 600, message: "API request rate limit exceeded" }));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/feature-flags", featureFlagRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/approvals", approvalRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/v1/invitations", invitationRoutes);
app.use("/api/v1/github", githubRoutes);

app.use((req, res) => {
  res.status(404).json(new ApiError(404, `Route not found: ${req.method} ${req.path}`));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err);
  }

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json(new ApiError(400, "Malformed JSON request body"));
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json(new ApiError(413, "Request body exceeds the 1 MB limit"));
  }
  if (err?.type === "request.aborted") {
    return res.status(400).json(new ApiError(400, "Request body was interrupted"));
  }

  if (err?.code === 11000) {
    return res.status(409).json(new ApiError(409, "A record with this unique value already exists"));
  }

  if (err?.name === "ValidationError") {
    return res.status(400).json(new ApiError(400, "Request validation failed", Object.values(err.errors || {}).map((item) => item.message)));
  }

  if (err?.name === "CastError") {
    return res.status(400).json(new ApiError(400, "Invalid identifier or value"));
  }

  console.error("Unhandled API error:", { name: err?.name, code: err?.code, method: req.method, path: req.path });
  return res.status(500).json(new ApiError(500, "Internal server error"));
});

export default app;
