import { AuditLog } from "../models/auditLog.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildAuditFeedFilter, createAuditFeedCursor, parseAuditFeedQuery } from "../utils/auditFeedPolicy.js";
import { boundAuditSnapshot } from "../utils/auditSnapshotPolicy.js";


export const listAuditActivity = asyncHandler(async (req, res) => {
  let parsed;
  try {
    parsed = parseAuditFeedQuery(req.query);
  } catch (error) {
    throw new ApiError(400, error.message || "Invalid audit query");
  }

  const filter = buildAuditFeedFilter(req.project._id, parsed);
  const rows = await AuditLog.find(filter)
    .populate({ path: "actorId", select: "name email" })
    .populate({ path: "flagId", select: "name key environment" })
    .sort({ createdAt: -1, _id: -1 })
    .limit(parsed.limit + 1)
    .lean();

  const hasMore = rows.length > parsed.limit;
  const page = hasMore ? rows.slice(0, parsed.limit) : rows;
  const items = page.map((entry) => ({
    id: String(entry._id),
    projectId: String(entry.projectId),
    flag: entry.flagId ? {
      id: String(entry.flagId._id),
      name: entry.flagId.name,
      key: entry.flagId.key,
      environment: entry.flagId.environment,
    } : null,
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    action: entry.action,
    actor: {
      id: entry.actorId?._id ? String(entry.actorId._id) : entry.changedBy,
      name: entry.actorId?.name || null,
      email: entry.actorId?.email || null,
      role: entry.actorRole || "unknown",
      type: entry.actorType || "legacy",
    },
    requestId: entry.requestId || null,
    before: boundAuditSnapshot(entry.before),
    after: boundAuditSnapshot(entry.after),
    createdAt: entry.createdAt,
  }));

  return res.status(200).json(new ApiResponse(200, {
    items,
    hasMore,
    nextCursor: hasMore && page.length ? createAuditFeedCursor(page[page.length - 1]) : null,
  }, "Audit activity loaded"));
});
