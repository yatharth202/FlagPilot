
export const PROJECT_ROLES = Object.freeze(["owner", "admin", "developer", "viewer"]);
export const PROJECT_MEMBER_ROLES = Object.freeze(["admin", "developer", "viewer"]);

const normalizeId = (value) => String(value?._id ?? value);

export const resolveProjectRole = (project, userId) => {
  if (!project || !userId) return null;

  const normalizedUserId = normalizeId(userId);
  if (project.ownerId && normalizeId(project.ownerId) === normalizedUserId) return "owner";

  const memberships = (project.members || []).filter(
    (entry) => entry?.userId && normalizeId(entry.userId) === normalizedUserId,
  );

  if (memberships.length !== 1) return null;

  const role = memberships[0].role;
  return PROJECT_MEMBER_ROLES.includes(role) ? role : null;
};

export const canAssignProjectRole = (actorRole, targetRole) => {
  if (!PROJECT_MEMBER_ROLES.includes(targetRole)) return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && ["developer", "viewer"].includes(targetRole);
};


export const canRemoveProjectMember = (actorRole, targetRole) => {
  if (!PROJECT_MEMBER_ROLES.includes(targetRole)) return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && ["developer", "viewer"].includes(targetRole);
};
