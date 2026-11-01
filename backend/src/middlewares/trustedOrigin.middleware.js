import { ApiError } from "../utils/ApiError.js";
import { parseFrontendOrigins } from "../utils/deploymentPolicy.js";

export const requireTrustedOrigin = (req, _res, next) => {
  const origin = req.get("origin");

  const allowedOrigins = parseFrontendOrigins(process.env.FRONTEND_ORIGIN, { production: process.env.NODE_ENV === "production" });
  if (origin && !allowedOrigins.includes(origin)) {
    return next(new ApiError(403, "Origin is not allowed for this authentication request"));
  }
  return next();
};
