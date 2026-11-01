import { ApiError } from "../utils/ApiError.js";
import { PROJECT_ROLES } from "../utils/projectRole.js";

export const requireRole = (allowedRoles = []) => {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0 || allowedRoles.some((role) => !PROJECT_ROLES.includes(role))) {
    throw new TypeError("requireRole must be configured with one or more valid project roles");
  }

  return (req, _res, next) => {
    if (!req.user) throw new ApiError(401, "Not authenticated");
    if (!req.project || !req.projectRole) {
      throw new ApiError(403, "Project authorization context is required");
    }
    if (!allowedRoles.includes(req.projectRole)) {
      throw new ApiError(403, `Access denied for project role: ${req.projectRole}`);
    }
    next();
  };
};
