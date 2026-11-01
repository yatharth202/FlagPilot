import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { requireProject } from "../middlewares/project.middleware.js";
import { requireRole } from "../middlewares/rbac.middleware.js";
import { createRateLimit } from "../utils/rateLimit.js";
import { ApiError } from "../utils/ApiError.js";
import {
  listAccessibleProjects, createProject, selectProject,
  getCurrentProject, rotateClientKey, updateCurrentProject,
  listProjectMembers, removeProjectMember, archiveCurrentProject,
} from "../controllers/project.controller.js";
import { createProjectInvitation, listProjectInvitations, resendProjectInvitation, revokeProjectInvitation } from "../controllers/invitation.controller.js";

const router = Router();
router.use(protect);


router.get("/", listAccessibleProjects);
router.post("/", createProject);
router.post("/:projectId/select", selectProject);

router.use(requireProject);
router.get("/current", getCurrentProject);
router.patch("/current", requireRole(["owner"]), updateCurrentProject);
router.delete("/current", requireRole(["owner"]), archiveCurrentProject);
router.post("/current/rotate-client-key", requireRole(["owner"]), rotateClientKey);
router.get("/current/members", listProjectMembers);
router.post("/current/members", requireRole(["owner", "admin"]), (_req, _res, next) => next(new ApiError(410, "Direct member additions are no longer supported. Send an invitation from the Team section so the recipient can accept it.")));
router.delete("/current/members/:userId", requireRole(["owner", "admin"]), removeProjectMember);
router.get("/current/invitations", requireRole(["owner", "admin"]), listProjectInvitations);
router.post("/current/invitations", requireRole(["owner", "admin"]), createRateLimit({ windowMs: 60 * 60_000, max: 20, message: "Invitation creation limit reached for this project" , keyGenerator: (req) => `project:${req.project._id}:actor:${req.user._id}` }), createProjectInvitation);
router.post("/current/invitations/:invitationId/resend", requireRole(["owner", "admin"]), createRateLimit({ windowMs: 60 * 60_000, max: 10, message: "Invitation resend limit reached for this project", keyGenerator: (req) => `project:${req.project._id}:actor:${req.user._id}` }), resendProjectInvitation);
router.delete("/current/invitations/:invitationId", requireRole(["owner", "admin"]), revokeProjectInvitation);
export default router;
