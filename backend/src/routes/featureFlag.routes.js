import { Router } from "express";
import {
  createFeatureFlag, copyFlagToEnvironment, getAllFeatureFlags, toggleFeatureFlag,
  updateTargeting, evaluatePublic, updateFeatureFlagSettingsController,
  getFeatureFlagVersionsController, rollbackFeatureFlagController,
} from "../controllers/featureFlag.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/rbac.middleware.js";
import { requireProject, requireClientKey } from "../middlewares/project.middleware.js";
import { createRateLimit } from "../utils/rateLimit.js";

const router = Router();


router.post(
  "/evaluate",
  createRateLimit({ windowMs: 60_000, max: 180, message: "Evaluation rate limit exceeded" }),
  requireClientKey,
  createRateLimit({
    windowMs: 60_000,
    max: 6000,
    message: "Project evaluation rate limit exceeded",
    keyGenerator: (req) => `client-key:${req.get("x-flagpilot-client-key") || "missing"}`,
  }),
  evaluatePublic,
);


router.use(protect, requireProject);
router.post("/", requireRole(["owner", "admin", "developer"]), createFeatureFlag);
router.post("/:id/copy-environment", requireRole(["owner", "admin", "developer"]), copyFlagToEnvironment);
router.get("/", getAllFeatureFlags);
router.put("/:id/targeting", requireRole(["owner", "admin", "developer"]), updateTargeting);
router.patch("/:id/settings", requireRole(["owner", "admin", "developer"]), updateFeatureFlagSettingsController);
router.put("/:id", requireRole(["owner", "admin", "developer"]), toggleFeatureFlag);
router.get("/:id/versions", getFeatureFlagVersionsController);
router.post("/:id/rollback", requireRole(["owner", "admin"]), rollbackFeatureFlagController);

export default router;
