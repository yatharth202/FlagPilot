/** Query all non-archived projects a user can access. */
export const buildAccessibleProjectsFilter = (userId) => {
  if (!userId) throw new TypeError("userId is required");
  return {
    archivedAt: null,
    $or: [{ ownerId: userId }, { "members.userId": userId }],
  };
};


export const resolvePreferredProjectId = (user) => user?.defaultProjectId || user?.projectId || null;


export const resolveRequestedProjectId = (headerValue, user) => {
  const selected = typeof headerValue === "string" ? headerValue.trim() : "";
  return selected || resolvePreferredProjectId(user);
};
