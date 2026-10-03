import type { Firestore } from "firebase-admin/firestore";
import type { AuditAction } from "@/types";

// Firestore here runs WITHOUT ignoreUndefinedProperties, so one `undefined`
// anywhere in an audit entry throws - and an audit write that throws after the
// real change has already been committed would turn a successful save into a
// 500. So: undefined values are stripped (recursively), and the write itself
// is best-effort - a failed audit entry is logged, never surfaced to the user.

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

export interface AuditEntryInput {
  action: AuditAction;
  performedBy: string;
  performedByName?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

/** Appends to colleges/{id}/auditLogs. Never throws. Returns whether the entry was written. */
export async function writeAuditLogSafe(db: Firestore, collegeId: string, entry: AuditEntryInput): Promise<boolean> {
  try {
    await db.collection("colleges").doc(collegeId).collection("auditLogs").add(
      stripUndefined({
        collegeId,
        action: entry.action,
        performedBy: entry.performedBy,
        performedByName: entry.performedByName ?? "Unknown",
        targetId: entry.targetId,
        details: entry.details ?? {},
        timestamp: new Date(),
      }) as Record<string, unknown>
    );
    return true;
  } catch (err) {
    console.error(`[audit] failed to record ${entry.action}`, err);
    return false;
  }
}
