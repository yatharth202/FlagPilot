import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { requireProject } from "../middlewares/project.middleware.js";
import { createRateLimit } from "../utils/rateLimit.js";
import { listAuditActivity } from "../controllers/audit.controller.js";

const router = Router();
router.use(protect, requireProject);
router.get("/", createRateLimit({ windowMs: 60_000, max: 120, message: "Audit activity rate limit exceeded" }), listAuditActivity);
export default router;
