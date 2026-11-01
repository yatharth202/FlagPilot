import { ApiError } from "../utils/ApiError.js";
import { buildInvitationAcceptUrl } from "../utils/projectInvitationPolicy.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const getInvitationEmailConfig = (env = process.env) => ({
  apiKey: String(env.RESEND_API_KEY || "").trim(),
  from: String(env.EMAIL_FROM || "").trim(),
  frontendOrigin: String(env.FRONTEND_ORIGIN || "").split(",")[0].trim(),
});

export const isInvitationEmailConfigured = (env = process.env) => {
  const config = getInvitationEmailConfig(env);
  return Boolean(config.apiKey && config.from && config.frontendOrigin);
};

export const sendProjectInvitationEmail = async ({
  email, projectName, inviterName, role, token, expiresAt,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) => {
  const config = getInvitationEmailConfig(env);
  if (!config.apiKey || !config.from || !config.frontendOrigin) {
    if (env.NODE_ENV === "production") {
      throw new ApiError(503, "Invitation email delivery is not configured. Set RESEND_API_KEY, EMAIL_FROM, and FRONTEND_ORIGIN.");
    }
    return {
      status: "not_configured",
      invitationUrl: buildInvitationAcceptUrl(config.frontendOrigin || "http://localhost:5173", token, { production: env.NODE_ENV === "production" }),
    };
  }

  const invitationUrl = buildInvitationAcceptUrl(config.frontendOrigin, token, { production: env.NODE_ENV === "production" });
  if (typeof fetchImpl !== "function") throw new ApiError(503, "Email delivery is unavailable in this runtime");

  const expiryLabel = new Date(expiresAt).toUTCString();
  const safeProject = escapeHtml(projectName);
  const safeInviter = escapeHtml(inviterName || "A FlagPilot teammate");
  const safeRole = escapeHtml(role);
  const safeUrl = escapeHtml(invitationUrl);
  const payload = {
    from: config.from,
    to: [email],
    subject: `Invitation to join ${projectName} on FlagPilot`,
    text: `${inviterName || "A teammate"} invited you to join ${projectName} on FlagPilot as ${role}. Accept the invitation: ${invitationUrl}. This invitation expires ${expiryLabel}. If you were not expecting this, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b"><h1>Join ${safeProject} on FlagPilot</h1><p>${safeInviter} invited you to collaborate as <strong>${safeRole}</strong>.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px">Accept invitation</a></p><p>This link expires ${expiryLabel}. If you were not expecting this invitation, you can ignore this email.</p></div>`,
  };

  let response;
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ApiError(502, "Invitation email provider could not be reached. The invitation remains pending; you can resend it.");
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "EMAIL_PROVIDER_AUTH" : `EMAIL_PROVIDER_${response.status}`;
    const error = new ApiError(502, "Invitation email could not be delivered. Check the email provider configuration and resend.");
    error.deliveryCode = code;
    throw error;
  }
  return { status: "sent", invitationUrl: null };
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
