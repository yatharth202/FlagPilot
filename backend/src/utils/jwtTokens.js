import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { JWT_POLICY, isValidTokenSubject, hasValidTokenClaims } from "./jwtPolicy.js";

const assertUserId = (userId) => {
  const value = String(userId || "");
  if (!isValidTokenSubject(value)) throw new TypeError("A valid user id is required to issue a token");
  return value;
};

export const issueAccessToken = (userId, authVersion = 0) => jwt.sign(
  { tokenUse: "access", authVersion },
  process.env.JWT_SECRET,
  {
    algorithm: JWT_POLICY.algorithm,
    subject: assertUserId(userId),
    issuer: JWT_POLICY.issuer,
    audience: JWT_POLICY.accessAudience,
    expiresIn: JWT_POLICY.accessTtl,
  },
);

export const issueRefreshToken = (userId, authVersion = 0) => jwt.sign(
  { tokenUse: "refresh", authVersion },
  process.env.JWT_REFRESH_SECRET,
  {
    algorithm: JWT_POLICY.algorithm,
    subject: assertUserId(userId),
    issuer: JWT_POLICY.issuer,
    audience: JWT_POLICY.refreshAudience,
    expiresIn: JWT_POLICY.refreshTtl,
  },
);

const verifyToken = (token, secret, audience, expectedUse) => {
  const decoded = jwt.verify(token, secret, {
    algorithms: [JWT_POLICY.algorithm],
    issuer: JWT_POLICY.issuer,
    audience,
    clockTolerance: 5,
  });
  if (!hasValidTokenClaims(decoded, expectedUse, audience)) throw new Error("Invalid token claims");
  return decoded;
};

export const verifyAccessToken = (token) => verifyToken(token, process.env.JWT_SECRET, JWT_POLICY.accessAudience, "access");
export const verifyRefreshToken = (token) => verifyToken(token, process.env.JWT_REFRESH_SECRET, JWT_POLICY.refreshAudience, "refresh");
export const hashRefreshToken = (token) => createHash("sha256").update(String(token)).digest("hex");
