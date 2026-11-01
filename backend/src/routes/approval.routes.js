import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { requireProject } from "../middlewares/project.middleware.js";
import { requireRole } from "../middlewares/rbac.middleware.js";
import {
  submitProductionChangeRequest, listProductionApprovalRequests,
  approveProductionChangeRequest, rejectProductionChangeRequest,
} from "../controllers/approval.controller.js";

const router = Router();
router.use(protect, requireProject);
router.post("/requests", requireRole(["developer"]), submitProductionChangeRequest);
router.get("/", requireRole(["owner", "admin"]), listProductionApprovalRequests);
router.post("/:id/approve", requireRole(["owner", "admin"]), approveProductionChangeRequest);
router.post("/:id/reject", requireRole(["owner", "admin"]), rejectProductionChangeRequest);
export default router;
