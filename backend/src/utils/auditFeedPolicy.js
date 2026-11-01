const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const AUDIT_ENTITY_TYPES = new Set([
  "feature_flag", "project", "project_member", "client_key", "approval_request", "project_invitation",
  "github_installation", "github_repository", "github_deployment",
]);

export const parseAuditFeedQuery = ({ limit, cursor, entityType } = {}) => {
  const parsedLimit = limit === undefined ? 50 : Number(limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    throw new TypeError("limit must be an integer between 1 and 50");
  }

  if (entityType !== undefined && entityType !== "all" && !AUDIT_ENTITY_TYPES.has(entityType)) {
    throw new TypeError("entityType is not supported");
  }

  let decodedCursor = null;
  if (cursor !== undefined && cursor !== "") {
    if (typeof cursor !== "string" || cursor.length > 512) {
      throw new TypeError("cursor is invalid");
    }
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      const createdAt = new Date(value.createdAt);
      if (typeof value.id !== "string" || !OBJECT_ID_PATTERN.test(value.id) || Number.isNaN(createdAt.getTime())) {
        throw new Error("invalid cursor fields");
      }
      decodedCursor = { createdAt, id: value.id };
    } catch {
      throw new TypeError("cursor is invalid");
    }
  }

  return {
    limit: parsedLimit,
    entityType: entityType && entityType !== "all" ? entityType : null,
    cursor: decodedCursor,
  };
};

export const createAuditFeedCursor = (entry) => Buffer.from(JSON.stringify({
  createdAt: new Date(entry.createdAt).toISOString(),
  id: String(entry._id),
})).toString("base64url");

export const buildAuditFeedFilter = (projectId, { entityType, cursor } = {}) => {
  const filter = { projectId };
  if (entityType) filter.entityType = entityType;
  if (cursor) {
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }
  return filter;
};
