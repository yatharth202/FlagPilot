import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { requireProject } from "../middlewares/project.middleware.js";
import { requireRole } from "../middlewares/rbac.middleware.js";
import { createRateLimit } from "../utils/rateLimit.js";
import {
  completeGitHubInstallation, completeGitHubOAuth, getGitHubOverview, startGitHubInstallation,
  listGitHubInstallationRepositoriesForProject, syncGitHubRepositories, disconnectGitHubInstallation,
} from "../controllers/github.controller.js";

const router = Router();


const callbackLimit = () => createRateLimit({
  windowMs: 10 * 60_000, max: 40,
  message: "GitHub callback rate limit reached. Restart the connection flow shortly.",
});
router.get("/installations/callback", callbackLimit(), completeGitHubInstallation);
router.get("/oauth/callback", callbackLimit(), completeGitHubOAuth);

router.use(protect, requireProject);
router.get("/current", getGitHubOverview);
router.post("/current/installations/start", requireRole(["owner", "admin"]), createRateLimit({ windowMs: 60 * 60_000, max: 10, message: "GitHub installation flow limit reached for this project", keyGenerator: (req) => `github-install:${req.project._id}:${req.user._id}` }), startGitHubInstallation);
router.get("/current/installations/:installationId/repositories", requireRole(["owner", "admin"]), listGitHubInstallationRepositoriesForProject);
router.put("/current/installations/:installationId/repositories", requireRole(["owner", "admin"]), syncGitHubRepositories);
router.delete("/current/installations/:installationId", requireRole(["owner", "admin"]), disconnectGitHubInstallation);

export default router;
