import { Router } from "express";
import { receiveGitHubWebhook } from "../controllers/githubWebhook.controller.js";
import { createRateLimit } from "../utils/rateLimit.js";

const router = Router();
router.post("/", createRateLimit({
  windowMs: 60_000,
  max: 1200,
  message: "GitHub webhook delivery rate limit exceeded",
}), receiveGitHubWebhook);
export default router;
