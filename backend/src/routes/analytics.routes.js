import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { requireProject, requireClientKey } from "../middlewares/project.middleware.js";
import { createRateLimit } from "../utils/rateLimit.js";
import { trackEvent, getAnalytics, getLogs } from "../controllers/analytics.controller.js";

const router = Router();
router.post(
  "/track",
  createRateLimit({ windowMs: 60_000, max: 90, message: "Event tracking rate limit exceeded" }),
  requireClientKey,
  createRateLimit({
    windowMs: 60_000,
    max: 3000,
    message: "Project event ingestion rate limit exceeded",
    keyGenerator: (req) => `client-key:${req.get("x-flagpilot-client-key") || "missing"}`,
  }),
  trackEvent,
);
router.use(protect, requireProject);
router.get("/", getAnalytics);
router.get("/logs", getLogs);
export default router;
