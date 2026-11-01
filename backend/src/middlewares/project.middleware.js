import mongoose from "mongoose";
import { Project } from "../models/project.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { isEnvironmentAllowedForClientKey, resolveClientKeyEnvironment } from "../utils/clientKeyPolicy.js";
import { resolveProjectRole } from "../utils/projectRole.js";
import { resolveRequestedProjectId } from "../utils/projectAccessPolicy.js";


export const requireProject = asyncHandler(async (req, _res, next) => {
  const requestedProjectId = resolveRequestedProjectId(req.get("x-flagpilot-project-id"), req.user);
  if (!requestedProjectId) {
    throw new ApiError(409, "No active project is selected. Create a project or select one from your workspace list.");
  }
  if (!mongoose.isValidObjectId(requestedProjectId)) {
    throw new ApiError(400, "Invalid project selector");
  }

  const project = await Project.findOne({
    _id: requestedProjectId,
    archivedAt: null,
    $or: [{ ownerId: req.user._id }, { "members.userId": req.user._id }],
  });
  if (!project) throw new ApiError(404, "Project not found or you do not have access to it");
  const projectRole = resolveProjectRole(project, req.user._id);
  if (!projectRole) {
    throw new ApiError(403, "Project membership is missing or inconsistent; access is denied until it is repaired");
  }
  req.project = project;
  req.projectRole = projectRole;
  next();
});


export const requireClientKey = asyncHandler(async (req, _res, next) => {
  const clientKey = String(req.get("x-flagpilot-client-key") || "").trim();
  if (!clientKey) throw new ApiError(401, "Missing x-flagpilot-client-key header");

  const project = await Project.findOne({ archivedAt: null, $or: [{ devClientKey: clientKey }, { prodClientKey: clientKey }] });
  if (!project) throw new ApiError(401, "Invalid FlagPilot client key");

  const environment = resolveClientKeyEnvironment(project, clientKey);
  if (!isEnvironmentAllowedForClientKey(environment, req.body?.environment) || !isEnvironmentAllowedForClientKey(environment, req.query?.environment)) {
    throw new ApiError(403, "This client key is not authorized for the requested environment");
  }

  req.project = project;
  req.sdkEnvironment = environment;
  next();
});
