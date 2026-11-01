import { AuditLog } from "../models/auditLog.model.js";
import { createInSession } from "./withMongoTransaction.js";
import { normalizeAuditActor, normalizeAuditEntity } from "./auditLogPolicy.js";

/** Create an append-only audit record in the same transaction as its mutation. */
export const createAuditLogInSession = async (entry, session = null) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("Audit entry must be an object");
  }
  const actor = normalizeAuditActor({ actorId: entry.actorId, actorRole: entry.actorRole });
  const entity = normalizeAuditEntity({ entityType: entry.entityType, entityId: entry.entityId, flagId: entry.flagId });
  const document = {
    ...entry,
    ...actor,
    ...entity,
    changedBy: actor.actorId || "system",
    requestId: entry.requestId || null,
  };
  return createInSession(AuditLog, document, session);
};
