export const REFRESH_COOKIE_NAME = "fp_refresh";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const getRefreshCookieOptions = (env = process.env) => {
  const production = env.NODE_ENV === "production";
  const sameSite = (env.REFRESH_COOKIE_SAME_SITE || "lax").toLowerCase();
  if (!["lax", "strict", "none"].includes(sameSite) || (sameSite === "none" && !production)) {
    throw new Error("Invalid refresh cookie SameSite policy for this environment");
  }
  return {
    httpOnly: true,
    secure: production,
    sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
};

export const readRefreshCookieValue = (cookieHeader) => {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 16_384) return null;
  let found = null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) continue;

    if (found !== null) return null;
    const value = part.slice(separator + 1).trim();
    if (!value || value.length > 4096) return null;
    found = value;
  }
  return found;
};

export const setRefreshCookie = (res, token, env = process.env) => res.cookie(
  REFRESH_COOKIE_NAME,
  token,
  getRefreshCookieOptions(env),
);

export const clearRefreshCookie = (res, env = process.env) => {
  const { maxAge, ...options } = getRefreshCookieOptions(env);
  return res.clearCookie(REFRESH_COOKIE_NAME, options);
};
