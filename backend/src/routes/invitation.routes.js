import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { createRateLimit } from "../utils/rateLimit.js";
import { acceptProjectInvitation, getInvitationPreview } from "../controllers/invitation.controller.js";

const router = Router();
router.post(
  "/preview",
  createRateLimit({ windowMs: 60_000, max: 30, message: "Too many invitation preview attempts" }),
  getInvitationPreview,
);
router.post(
  "/accept",
  createRateLimit({ windowMs: 60_000, max: 10, message: "Too many invitation acceptance attempts" }),
  protect,
  acceptProjectInvitation,
);
export default router;
