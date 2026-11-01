import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/jwtTokens.js";
import { isAuthVersionCurrent } from "../utils/jwtPolicy.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authHeader);
  if (!match || match[1].length > 4096) throw new ApiError(401, "Not authorized");

  let decoded;
  try {
    decoded = verifyAccessToken(match[1]);
  } catch {
    throw new ApiError(401, "Invalid or expired access token");
  }

  const user = await User.findById(decoded.sub);
  if (!user || !isAuthVersionCurrent(decoded.authVersion, user.authVersion)) {
    throw new ApiError(401, "Session is no longer valid; sign in again");
  }

  req.user = user;
  next();
});
