import { timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_STATE_COOKIE_NAME = "fp_google_oauth_state";
export const GOOGLE_OAUTH_STATE_COOKIE_PATH = "/api/v1/auth/google";
export const GOOGLE_OAUTH_STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export const getGoogleOAuthStateCookieOptions = (env = process.env) => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: GOOGLE_OAUTH_STATE_COOKIE_PATH,
  maxAge: GOOGLE_OAUTH_STATE_COOKIE_MAX_AGE_MS,
});

export const readGoogleOAuthStateCookie = (cookieHeader) => {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 16_384) return null;
  let found = null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== GOOGLE_OAUTH_STATE_COOKIE_NAME) continue;
    if (found !== null) return null;
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) return null;
    found = value;
  }
  return found;
};

export const googleOAuthStateMatches = (cookieState, queryState) => {
  if (typeof cookieState !== "string" || typeof queryState !== "string") return false;
  const left = Buffer.from(cookieState);
  const right = Buffer.from(queryState);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const setGoogleOAuthStateCookie = (res, state, env = process.env) =>
  res.cookie(GOOGLE_OAUTH_STATE_COOKIE_NAME, state, getGoogleOAuthStateCookieOptions(env));

export const clearGoogleOAuthStateCookie = (res, env = process.env) =>
  res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE_NAME, {
    ...getGoogleOAuthStateCookieOptions(env),
    maxAge: undefined,
  });
