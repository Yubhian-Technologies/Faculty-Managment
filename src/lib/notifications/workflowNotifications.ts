import type { Firestore } from "firebase-admin/firestore";
import type { NotificationType } from "@/types";

// Generic, module-agnostic workflow notification framework - not specific to
// Budget or any other domain. A workflow route calls emitWorkflowNotification
// when ownership of a task moves to the next responsible user(s), and
// resolveWorkflowNotifications when that task is completed. Any future module
// (Leave, Indent, Purchase Clearance, ...) can adopt these at its own
// transition points without touching this file - src/lib/notify.ts's plain
// notify()/notifyRole() are untouched and still used by every existing caller.

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: number | string } | undefined)?.code;
  return code === 6 || code === "already-exists";
}

export interface EmitWorkflowNotificationParams {
  db: Firestore;
  collegeId: string;
  toUid: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  /** What kind of workflow entity this notification is about, e.g. "budgetRequest". */
  entityType: string;
  /** The id of that entity. */
  entityId: string;
  /**
   * Stable id for this exact notification. Creation is idempotent on this key
   * (via a deterministic Firestore doc id), so retries/duplicate workflow
   * transitions never create a second popup for the same event.
   */
  dedupeKey: string;
  /** Surfaces as a login popup until resolveWorkflowNotifications clears it. Defaults to true. */
  actionable?: boolean;
}

export async function emitWorkflowNotification(params: EmitWorkflowNotificationParams): Promise<void> {
  const { db, collegeId, toUid, type, title, message, link, entityType, entityId, dedupeKey, actionable = true } = params;
  const ref = db
    .collection("colleges")
    .doc(collegeId)
    .collection("notifications")
    .doc(dedupeKey);
  try {
    await ref.create({
      collegeId,
      toUid,
      type,
      title,
      message,
      link: link ?? null,
      read: false,
      actionable,
      resolved: false,
      entityType,
      entityId,
      dedupeKey,
      createdAt: new Date(),
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    // Already emitted for this event - nothing to do.
  }
}

export interface ResolveWorkflowNotificationsParams {
  db: Firestore;
  collegeId: string;
  entityType: string;
  entityId: string;
}

// Marks every actionable, unresolved notification tied to this workflow
// entity as resolved - they stop appearing as login popups but remain in
// notification history. Safe to call even if nothing matches.
export async function resolveWorkflowNotifications(params: ResolveWorkflowNotificationsParams): Promise<void> {
  const { db, collegeId, entityType, entityId } = params;
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("notifications")
    .where("entityType", "==", entityType)
    .where("entityId", "==", entityId)
    .where("actionable", "==", true)
    .where("resolved", "==", false)
    .get();

  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { resolved: true }));
  await batch.commit();
}
