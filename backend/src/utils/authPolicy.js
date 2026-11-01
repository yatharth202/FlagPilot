/** Self-registration creates the owner of a newly isolated project. */
export const resolveRegistrationRole = () => "owner";

/** Normalize account identifiers before using them as privacy-preserving rate-limit keys. */
export const normalizeLoginIdentifier = (value) => {
  if (typeof value !== "string") return "invalid";
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= 254 ? normalized : "invalid";
};


export const canUsePasswordLogin = ({ storedPassword, passwordMatches }) =>
  typeof storedPassword === "string" && storedPassword.length > 0 && passwordMatches === true;
