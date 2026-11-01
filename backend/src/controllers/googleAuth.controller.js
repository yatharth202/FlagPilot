import { User } from "../models/user.model.js";
import { Project } from "../models/project.model.js";
import { GoogleOAuthState } from "../models/googleOAuthState.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { setRefreshCookie } from "../utils/authCookiePolicy.js";
import { issueAccessToken, issueRefreshToken, hashRefreshToken } from "../utils/jwtTokens.js";
import { parseFrontendOrigins } from "../utils/deploymentPolicy.js";
import {
  clearGoogleOAuthStateCookie,
  googleOAuthStateMatches,
  readGoogleOAuthStateCookie,
  setGoogleOAuthStateCookie,
} from "../utils/googleOAuthStateCookie.js";
import {
  buildGoogleAuthorizationUrl,
  createOAuthRandomValue,
  createPkceChallenge,
  exchangeGoogleAuthorizationCode,
  getGoogleAllowedHostedDomains,
  getGoogleHostedDomainHint,
  GOOGLE_OAUTH_STATE_TTL_MS,
  isGoogleOAuthConfigured,
  normalizeGoogleReturnTo,
  sha256Base64Url,
  verifyGoogleIdToken,
} from "../services/googleOAuth.service.js";
import { getProjectContext } from "./auth.controller.js";

const getFrontendOrigin = () => parseFrontendOrigins(process.env.FRONTEND_ORIGIN, {
  production: process.env.NODE_ENV === "production",
})[0];

const redirectToFrontend = (res, path) => {
  const destination = new URL(path, `${getFrontendOrigin()}/`);
  return res.redirect(303, destination.toString());
};

const addGoogleError = (returnTo, code) => {
  const path = returnTo === "/invite/accept" ? "/login" : returnTo;
  const url = new URL(path, "https://flagpilot.invalid");
  url.searchParams.set("google_error", code);
  if (returnTo === "/invite/accept") url.searchParams.set("next", "/invite/accept");
  return `${url.pathname}${url.search}`;
};

const findOrCreateGoogleUser = async (profile) => {
  let user = await User.findOne({ googleId: profile.googleId });
  if (user) return user;

  user = await User.findOne({ email: profile.email });
  if (user) {
    if (user.googleId && user.googleId !== profile.googleId) {
      throw new ApiError(409, "This email is already linked to a different Google account. Sign in with the originally linked account.");
    }
    let linked;
    try {
      linked = await User.updateOne(
        {
          _id: user._id,
          $or: [{ googleId: { $exists: false } }, { googleId: null }, { googleId: profile.googleId }],
        },
        { $set: { googleId: profile.googleId } },
      );
    } catch (error) {
      if (error?.code === 11000) {
        throw new ApiError(409, "This Google account is already linked to another FlagPilot account.");
      }
      throw error;
    }
    if (linked.modifiedCount !== 1 && linked.matchedCount !== 1) {
      const winner = await User.findOne({ googleId: profile.googleId });
      if (!winner) throw new ApiError(409, "This account was linked concurrently. Please restart Google sign-in.");
      return winner;
    }
    return User.findById(user._id);
  }

  let createdUser;
  let createdProject;
  try {
    createdUser = await User.create({
      name: profile.name,
      email: profile.email,
      googleId: profile.googleId,
      role: "viewer",
    });
    createdProject = await Project.create({ ownerId: createdUser._id, name: `${profile.name}'s project` });
    createdUser.projectId = createdProject._id;
    createdUser.defaultProjectId = createdProject._id;
    await createdUser.save({ validateBeforeSave: false });
    return createdUser;
  } catch (error) {
    if (createdProject) await Project.deleteOne({ _id: createdProject._id }).catch(() => {});
    if (createdUser) await User.deleteOne({ _id: createdUser._id }).catch(() => {});

    if (error?.code === 11000) {
      const winner = await User.findOne({ $or: [{ googleId: profile.googleId }, { email: profile.email }] });
      if (winner?.googleId === profile.googleId && winner.email === profile.email) return winner;
      if (winner && !winner.googleId && winner.email === profile.email) {
        const link = await User.updateOne(
          { _id: winner._id, $or: [{ googleId: { $exists: false } }, { googleId: null }] },
          { $set: { googleId: profile.googleId } },
        );
        if (link.modifiedCount === 1 || link.matchedCount === 1) return User.findById(winner._id);
      }
    }
    throw error;
  }
};

const establishFlagPilotSession = async (user, res) => {
  const projectContext = await getProjectContext(user);
  const previousAuthVersion = Number(user.authVersion || 0);
  const authVersion = previousAuthVersion + 1;
  const accessToken = issueAccessToken(user._id, authVersion);
  const refreshToken = issueRefreshToken(user._id, authVersion);

  const updated = await User.updateOne(
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
  if (updated.modifiedCount !== 1) throw new ApiError(409, "The account session changed during Google sign-in. Please retry.");

  setRefreshCookie(res, refreshToken);
  return projectContext;
};

export const startGoogleLogin = asyncHandler(async (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    return redirectToFrontend(res, "/login?google_error=not_configured");
  }

  const state = createOAuthRandomValue(32);
  const nonce = createOAuthRandomValue(32);
  const codeVerifier = createOAuthRandomValue(48);
  const returnTo = normalizeGoogleReturnTo(req.query?.next);

  await GoogleOAuthState.create({
    stateHash: sha256Base64Url(state),
    nonceHash: sha256Base64Url(nonce),
    codeVerifier,
    returnTo,
    expiresAt: new Date(Date.now() + GOOGLE_OAUTH_STATE_TTL_MS),
  });

  setGoogleOAuthStateCookie(res, state);

  const authorizationUrl = buildGoogleAuthorizationUrl({
    clientId: process.env.GOOGLE_CLIENT_ID?.trim(),
    callbackUrl: process.env.GOOGLE_OAUTH_CALLBACK_URL?.trim(),
    state,
    nonce,
    codeChallenge: createPkceChallenge(codeVerifier),
    hostedDomainHint: getGoogleHostedDomainHint(),
  });
  return res.redirect(302, authorizationUrl);
});

export const completeGoogleLogin = asyncHandler(async (req, res) => {
  const state = typeof req.query?.state === "string" ? req.query.state : "";
  let stateRecord = null;
  let returnTo = "/dashboard";

  try {
    const browserState = readGoogleOAuthStateCookie(req.headers.cookie);
    clearGoogleOAuthStateCookie(res);
    if (!state || state.length > 512 || !googleOAuthStateMatches(browserState, state)) {
      throw new ApiError(400, "Google sign-in state does not match this browser. Start again.");
    }
    stateRecord = await GoogleOAuthState.findOneAndDelete({
      stateHash: sha256Base64Url(state),
      expiresAt: { $gt: new Date() },
    }).select("+nonceHash +codeVerifier returnTo");
    if (!stateRecord) throw new ApiError(400, "Google sign-in state expired or was already used. Start again.");
    returnTo = normalizeGoogleReturnTo(stateRecord.returnTo);

    if (req.query?.error) {
      return redirectToFrontend(res, addGoogleError(returnTo, "cancelled"));
    }
    const code = typeof req.query?.code === "string" ? req.query.code : "";
    if (!code || code.length > 4096) throw new ApiError(400, "Google did not return an authorization code.");

    const idToken = await exchangeGoogleAuthorizationCode({ code, codeVerifier: stateRecord.codeVerifier });
    const profile = await verifyGoogleIdToken(idToken, {
      clientId: process.env.GOOGLE_CLIENT_ID?.trim(),
      expectedNonceHash: stateRecord.nonceHash,
      allowedHostedDomains: getGoogleAllowedHostedDomains(),
    });
    const user = await findOrCreateGoogleUser(profile);
    await establishFlagPilotSession(user, res);
    return redirectToFrontend(res, returnTo);
  } catch (error) {

    console.error("Google sign-in failed:", { statusCode: error?.statusCode || 500, code: error?.code || "GOOGLE_OAUTH_FAILED" });
    if (res.headersSent) return;
    const safeError = error?.message?.includes("already linked") ? "account_conflict" : "failed";
    return redirectToFrontend(res, addGoogleError(returnTo, safeError));
  }
});
