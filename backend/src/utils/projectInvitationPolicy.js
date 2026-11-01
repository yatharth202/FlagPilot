import { createHash, randomBytes } from "node:crypto";

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

export const normalizeInvitationEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isValidInvitationEmail = (value) => {
  const email = normalizeInvitationEmail(value);
  return email.length <= 254 && EMAIL_PATTERN.test(email);
};

export const generateInvitationToken = () => randomBytes(32).toString("base64url");

export const isValidInvitationToken = (token) =>
  typeof token === "string" && TOKEN_PATTERN.test(token);

export const hashInvitationToken = (token) => {
  if (!isValidInvitationToken(token)) throw new TypeError("Invitation token is invalid");
  return createHash("sha256").update(token, "utf8").digest("hex");
};

export const getInvitationTtlMs = (rawHours = process.env.INVITATION_TTL_HOURS) => {
  const hours = rawHours === undefined || rawHours === "" ? 168 : Number(rawHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
    throw new TypeError("INVITATION_TTL_HOURS must be an integer between 1 and 720");
  }
  return hours * 60 * 60 * 1000;
};

export const isInvitationUsable = (invitation, now = new Date()) => Boolean(
  invitation && invitation.status === "pending" && invitation.expiresAt && new Date(invitation.expiresAt).getTime() > now.getTime(),
);

export const buildInvitationAcceptUrl = (frontendOrigin, token, { production = process.env.NODE_ENV === "production" } = {}) => {
  if (typeof frontendOrigin !== "string" || !frontendOrigin.trim() || !isValidInvitationToken(token)) {
    throw new TypeError("A valid frontend origin and invitation token are required");
  }
  let url;
  try { url = new URL(frontendOrigin); }
  catch { throw new TypeError("Invitation frontend origin must be an exact HTTP(S) origin"); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.origin !== frontendOrigin || url.username || url.password) {
    throw new TypeError("Invitation frontend origin must be an exact HTTP(S) origin");
  }
  if (production && url.protocol !== "https:") {
    throw new TypeError("Production invitation links must use HTTPS");
  }
  url.pathname = "/invite/accept";
  url.search = "";
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
};


export const INVITATION_RESEND_COOLDOWN_MS = 60_000;

export const getInvitationResendCooldownRemainingMs = (lastResentAt, now = Date.now()) => {
  if (lastResentAt == null) return 0;
  const timestamp = new Date(lastResentAt).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return INVITATION_RESEND_COOLDOWN_MS;
  return Math.max(0, timestamp + INVITATION_RESEND_COOLDOWN_MS - now);
};

export const isPendingInvitationDuplicateKeyError = (error) => {
  if (error?.code !== 11000) return false;
  const message = String(error.message || "");
  const pattern = error.keyPattern || {};
  return message.includes("one_pending_invitation_per_project_email")
    || (pattern.projectId === 1 && pattern.email === 1);
};
