import type { Firestore } from "firebase-admin/firestore";

// One place to write a college audit-log entry. Best effort by design: the
// action it records has already happened, so a logging failure must never turn
// a successful request into an error (the same rule the routes that log inline
// already follow). Fields that are undefined are dropped - Firestore rejects
// them.

export interface AuditEntry {
  action: string;
  performedBy: string;
  performedByName?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export async function writeAuditLog(db: Firestore, collegeId: string, entry: AuditEntry): Promise<void> {
  try {
    await db.collection("colleges").doc(collegeId).collection("auditLogs").add(
      stripUndefined({
        collegeId,
        action: entry.action,
        performedBy: entry.performedBy,
        performedByName: entry.performedByName,
        targetId: entry.targetId,
        details: entry.details ? stripUndefined(entry.details) : {},
        timestamp: new Date(),
      })
    );
  } catch (err) {
    console.error(`[audit] failed to write ${entry.action}`, err);
  }
}
