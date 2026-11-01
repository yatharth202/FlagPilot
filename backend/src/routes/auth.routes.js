import express from "express";
import { register, login, logout } from "../controllers/auth.controller.js";
import { startGoogleLogin, completeGoogleLogin } from "../controllers/googleAuth.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/rbac.middleware.js";
import { requireProject } from "../middlewares/project.middleware.js";
import { refreshAccessToken } from "../controllers/auth.controller.js";
import { createRateLimit } from "../utils/rateLimit.js";
import { normalizeLoginIdentifier } from "../utils/authPolicy.js";
import { requireTrustedOrigin } from "../middlewares/trustedOrigin.middleware.js";

const router = express.Router();

router.get("/google", createRateLimit({ windowMs: 15 * 60_000, max: 20, message: "Too many Google sign-in attempts; try again later" }), startGoogleLogin);
router.get("/google/callback", createRateLimit({ windowMs: 15 * 60_000, max: 30, message: "Too many Google callback attempts; try again later" }), completeGoogleLogin);

router.use(requireTrustedOrigin);

router.post("/register", createRateLimit({ windowMs: 15 * 60_000, max: 10, message: "Too many registration attempts; try again later" }), register);
router.post(
  "/login",
  createRateLimit({ windowMs: 15 * 60_000, max: 20, message: "Too many login attempts from this network; try again later" }),
  createRateLimit({
    windowMs: 15 * 60_000,
    max: 30,
    message: "Too many attempts for this account; try again later",
    keyGenerator: (req) => `account:${normalizeLoginIdentifier(req.body?.email)}`,
  }),
  login,
);
router.post("/refresh-token", createRateLimit({ windowMs: 60_000, max: 60, message: "Too many token refresh attempts" }), refreshAccessToken);
router.post("/logout", createRateLimit({ windowMs: 60_000, max: 30, message: "Too many logout requests" }), logout);

router.get("/me", protect, requireProject, (req, res) => {
  res.json({
    message: "Access granted",
    user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.projectRole, projectId: req.project._id, createdAt: req.user.createdAt }
  });
});

router.get(
  "/admin",
  protect,
  requireProject,
  requireRole(["owner", "admin"]),
  (req, res) => {
    res.json({
      message: "Admin access granted"
    });
  }
);

export default router;