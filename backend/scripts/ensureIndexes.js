import dotenv from "dotenv";
import mongoose from "mongoose";
import { User } from "../src/models/user.model.js";
import { Project } from "../src/models/project.model.js";
import { FeatureFlag } from "../src/models/featureFlag.model.js";
import { Analytics } from "../src/models/analytics.model.js";
import { AuditLog } from "../src/models/auditLog.model.js";
import { ApprovalRequest } from "../src/models/approvalRequest.model.js";
import { ProjectInvitation } from "../src/models/projectInvitation.model.js";
import { GitHubInstallState } from "../src/models/githubInstallState.model.js";
import { GitHubInstallation } from "../src/models/githubInstallation.model.js";
import { GitHubProjectInstallation } from "../src/models/githubProjectInstallation.model.js";
import { GitHubRepositoryLink } from "../src/models/githubRepositoryLink.model.js";
import { GitHubDeployment } from "../src/models/githubDeployment.model.js";
import { GitHubWebhookDelivery } from "../src/models/githubWebhookDelivery.model.js";
import { GoogleOAuthState } from "../src/models/googleOAuthState.model.js";

dotenv.config();
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is required. Configure backend/.env first.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  for (const model of [User, Project, FeatureFlag, Analytics, AuditLog, ApprovalRequest, ProjectInvitation, GitHubInstallState, GitHubInstallation, GitHubProjectInstallation, GitHubRepositoryLink, GitHubDeployment, GitHubWebhookDelivery, GoogleOAuthState]) {
    await model.createIndexes();
    console.log(`Indexes verified: ${model.collection.name}`);
  }
  console.log("FlagPilot indexes are ready.");
} catch (error) {
  console.error("Index setup failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
