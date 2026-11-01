import bcrypt from "bcryptjs";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { resolveRegistrationRole, canUsePasswordLogin } from "../utils/authPolicy.js";
import { resolveProjectRole } from "../utils/projectRole.js";
import { buildAccessibleProjectsFilter, resolvePreferredProjectId } from "../utils/projectAccessPolicy.js";
import { Project } from "../models/project.model.js";
import { issueAccessToken, issueRefreshToken, verifyRefreshToken, hashRefreshToken } from "../utils/jwtTokens.js";
import { isAuthVersionCurrent } from "../utils/jwtPolicy.js";

import { setRefreshCookie, clearRefreshCookie, readRefreshCookieValue } from "../utils/authCookiePolicy.js";

const readRefreshCookie = (req) => readRefreshCookieValue(req.headers.cookie);
const dummyPasswordHashPromise = bcrypt.hash("flagpilot-invalid-login-comparison-only", 10);

export const register = asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "A JSON request body is required");
  const { name, email: submittedEmail, password } = body;
  if (typeof name !== "string" || typeof submittedEmail !== "string" || typeof password !== "string") {
    throw new ApiError(400, "Name, email, and password must be strings");
  }
  const email = submittedEmail.trim().toLowerCase();
  const cleanName = name.trim();

  if (!cleanName || !email || !password) {
    throw new ApiError(400, "All fields are required");
  }
  if (cleanName.length > 80 || email.length > 254) {
    throw new ApiError(400, "Name must be at most 80 characters and email at most 254 characters");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw new ApiError(400, "Password must be at least 8 characters and at most 72 UTF-8 bytes");
  }

  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new ApiError(409, "User already exists");
  }


  const role = resolveRegistrationRole({ email });
  const user = await User.create({ name: cleanName, email, password, role });
  let project = null;
  let accessToken;
  let refreshToken;
  try {
    project = await Project.create({ ownerId: user._id, name: `${cleanName}'s project` });
    user.projectId = project._id; // legacy compatibility alias
    user.defaultProjectId = project._id;
    await user.save({ validateBeforeSave: false });

    const authVersion = Number(user.authVersion || 0);
    accessToken = issueAccessToken(user._id, authVersion);
    refreshToken = issueRefreshToken(user._id, authVersion);
    user.refreshToken = hashRefreshToken(refreshToken);
    await user.save({ validateBeforeSave: false });
  } catch (error) {

    if (project) await Project.deleteOne({ _id: project._id }).catch(() => {});
    await User.deleteOne({ _id: user._id }).catch(() => {});
    throw error;
  }

  setRefreshCookie(res, refreshToken);
  return res.status(201).json(
    new ApiResponse(
      201,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: "owner",
          projectId: user.projectId
        },
        accessToken,
      },
      "User registered successfully"
    )
  );
});

export const getProjectContext = async (user) => {
  const preferredId = resolvePreferredProjectId(user);
  let project = preferredId
    ? await Project.findOne({
      _id: preferredId,
      archivedAt: null,
      $or: [{ ownerId: user._id }, { "members.userId": user._id }],
    }).select("ownerId members")
    : null;

  if (!project) {
    project = await Project.findOne(buildAccessibleProjectsFilter(user._id))
      .sort({ createdAt: 1 })
      .select("ownerId members");
  }
  if (!project) throw new ApiError(409, "This account has no active projects. Create a project or accept a project invitation.");
  const role = resolveProjectRole(project, user._id);
  if (!role) throw new ApiError(403, "Project membership is missing or inconsistent. Access is denied.");

  if (String(user.defaultProjectId || "") !== String(project._id) || String(user.projectId || "") !== String(project._id)) {
    await User.updateOne({ _id: user._id }, { $set: { defaultProjectId: project._id, projectId: project._id } });
  }
  return { projectId: project._id, role };
};

export const login = asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "A JSON request body is required");
  const { email: submittedEmail, password } = body;
  if (typeof submittedEmail !== "string" || typeof password !== "string") throw new ApiError(400, "Email and password must be strings");
  const email = submittedEmail.trim().toLowerCase();
  if (!email || email.length > 254 || !password || Buffer.byteLength(password, "utf8") > 72) {
    throw new ApiError(400, "Email or password is invalid");
  }

  const user = await User.findOne({ email }).select("+password");

  const storedPassword = user?.password;
  const passwordHash = storedPassword || await dummyPasswordHashPromise;
  const isMatch = await bcrypt.compare(password, passwordHash);

  if (!user || !canUsePasswordLogin({ storedPassword, passwordMatches: isMatch })) {
    throw new ApiError(401, "Invalid credentials");
  }

  const projectContext = await getProjectContext(user);
  const previousAuthVersion = Number(user.authVersion || 0);
  const authVersion = previousAuthVersion + 1;
  const accessToken = issueAccessToken(user._id, authVersion);
  const refreshToken = issueRefreshToken(user._id, authVersion);

  const loginSession = await User.updateOne(
    {
      _id: user._id,
      $or: [
        { authVersion: previousAuthVersion },
        { authVersion: { $exists: false } },
        { authVersion: null },
      ],
    },
    { $set: { authVersion, refreshToken: hashRefreshToken(refreshToken) } },
  );
  if (loginSession.modifiedCount !== 1) {
    throw new ApiError(409, "The account session changed during login. Please retry.");
  }

  setRefreshCookie(res, refreshToken);
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: projectContext.role,
          projectId: projectContext.projectId
        },
        accessToken,
      },
      "Login successful"
    )
  );
});

export const refreshAccessToken = asyncHandler(async (req, res) => {
  const refreshToken = readRefreshCookie(req);
  if (typeof refreshToken !== "string" || refreshToken.length < 100 || refreshToken.length > 4096) {
    clearRefreshCookie(res);
    throw new ApiError(401, "Invalid refresh token");
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    clearRefreshCookie(res);
    throw new ApiError(401, "Invalid refresh token");
  }

  const oldTokenHash = hashRefreshToken(refreshToken);
  const user = await User.findById(decoded.sub).select("+refreshToken");
  if (!user || user.refreshToken !== oldTokenHash || !isAuthVersionCurrent(decoded.authVersion, user.authVersion)) {
    clearRefreshCookie(res);
    throw new ApiError(401, "Invalid refresh token");
  }

  const projectContext = await getProjectContext(user);
  const authVersion = Number(user.authVersion || 0);
  const newAccessToken = issueAccessToken(user._id, authVersion);
  const newRefreshToken = issueRefreshToken(user._id, authVersion);
  const newTokenHash = hashRefreshToken(newRefreshToken);


  const rotation = await User.updateOne(
    { _id: user._id, refreshToken: oldTokenHash, authVersion },
    { $set: { refreshToken: newTokenHash } },
  );
  if (rotation.modifiedCount !== 1) {
    throw new ApiError(401, "Refresh token has already been used or revoked");
  }

  setRefreshCookie(res, newRefreshToken);
  return res.status(200).json(
    new ApiResponse(200, { accessToken: newAccessToken, role: projectContext.role, projectId: projectContext.projectId }, "Token refreshed")
  );
});

export const logout = asyncHandler(async (req, res) => {
  const refreshToken = readRefreshCookie(req);
  if (typeof refreshToken === "string" && refreshToken.length >= 100 && refreshToken.length <= 4096) {
    try {
      const decoded = verifyRefreshToken(refreshToken);
      await User.updateOne(
        { _id: decoded.sub, refreshToken: hashRefreshToken(refreshToken), authVersion: decoded.authVersion },
        { $unset: { refreshToken: 1 }, $inc: { authVersion: 1 } },
      );
    } catch {
    }
  }
  clearRefreshCookie(res);
  return res.status(200).json(new ApiResponse(200, null, "Logged out"));
});
