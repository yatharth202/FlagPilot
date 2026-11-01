const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const USER_ROLES = new Set(["owner", "admin", "developer", "viewer", "invited"]);

export const normalizeAuditActor = ({ actorId = null, actorRole = null } = {}) => {
  if (actorId !== null && actorId !== undefined && !OBJECT_ID_PATTERN.test(String(actorId))) {
    throw new TypeError("Audit actorId must be a valid user ObjectId");
  }
  if (actorId) {
    if (!USER_ROLES.has(actorRole)) {
      throw new TypeError("Audit entries for user actions require the actor's authoritative project role");
    }
    return { actorId: String(actorId), actorType: "user", actorRole };
  }
  if (actorRole && actorRole !== "system") {
    throw new TypeError("System audit entries must use actorRole=system");
  }
  return { actorId: null, actorType: "system", actorRole: "system" };
};

export const normalizeAuditEntity = ({ entityType = "feature_flag", entityId = null, flagId = null } = {}) => {
  const resolvedId = entityId || flagId;
  if (!resolvedId || !OBJECT_ID_PATTERN.test(String(resolvedId))) {
    throw new TypeError("Audit entityId is required and must be a valid ObjectId");
  }
  if (entityType === "feature_flag" && !flagId) {
    throw new TypeError("Feature-flag audit entries require flagId");
  }
  if (!["feature_flag", "project", "project_member", "client_key", "approval_request", "project_invitation", "github_installation", "github_repository", "github_deployment"].includes(entityType)) {
    throw new TypeError("Unsupported audit entityType");
  }
  return { entityType, entityId: resolvedId };
};
