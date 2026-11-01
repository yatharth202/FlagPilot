export const JWT_POLICY = Object.freeze({
  algorithm: "HS256",
  issuer: "flagpilot-api",
  accessAudience: "flagpilot-access",
  refreshAudience: "flagpilot-refresh",
  accessTtl: "15m",
  refreshTtl: "7d",
});

const USER_ID_PATTERN = /^[a-f0-9]{24}$/i;

export const isValidTokenSubject = (subject) => typeof subject === "string" && USER_ID_PATTERN.test(subject);

export const hasValidTokenClaims = (decoded, expectedUse, expectedAudience) => Boolean(
  decoded
  && typeof decoded === "object"
  && decoded.tokenUse === expectedUse
  && Number.isSafeInteger(decoded.authVersion)
  && decoded.authVersion >= 0
  && isValidTokenSubject(decoded.sub)
  && decoded.iss === JWT_POLICY.issuer
  && decoded.aud === expectedAudience,
);

/** Only tokens minted for the account's current authVersion remain valid. */
export const isAuthVersionCurrent = (tokenVersion, storedVersion) => {
  const current = storedVersion === undefined || storedVersion === null ? 0 : storedVersion;
  return Number.isSafeInteger(tokenVersion) && Number.isSafeInteger(current) && tokenVersion === current && current >= 0;
};
