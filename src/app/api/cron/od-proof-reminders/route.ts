export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import { evaluateODProof } from "@/lib/leave/odProof";
import type { LeaveRequest } from "@/types/leave";

// Not a user-facing route - hit on a schedule (see functions/src/index.ts)
// with a shared secret, same convention as cron/attendance-not-posted.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed - never run unconfigured
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// For one college: every approved, proof-required On Duty request whose
// period ended at least 24h ago with nothing uploaded yet (AWAITING_UPLOAD -
// deliberately not REJECTED_REUPLOAD, which already got its own rejection
// notification with a due date via notifyODProofDecision) gets one reminder,
// deduped per request via emitWorkflowNotification's dedupeKey so re-running
// this sweep every tick never re-sends it once it's gone out.
async function sweepCollege(db: FirebaseFirestore.Firestore, collegeId: string, now: Date): Promise<number> {
  const snap = await db
    .collection("colleges").doc(collegeId).collection("leaveRequests")
    .where("leaveTypeCode", "==", "OD")
    .where("status", "==", "APPROVED")
    .where("odProofRequired", "==", true)
    .get();

  let notified = 0;
  for (const doc of snap.docs) {
    const req = { id: doc.id, ...doc.data() } as LeaveRequest;
    const evaluation = evaluateODProof(req, now);
    if (evaluation.state !== "AWAITING_UPLOAD" || !evaluation.periodEnd) continue;
    if (now.getTime() - evaluation.periodEnd.getTime() < REMINDER_DELAY_MS) continue;

    await emitWorkflowNotification({
      db,
      collegeId,
      toUid: req.uid,
      type: "LEAVE_OD_PROOF_UPLOAD_REMINDER",
      title: "Upload your On Duty proof",
      message: `Your On Duty leave ending ${formatDate(evaluation.periodEnd)} needs proof of duty uploaded - unproven days become Loss of Pay once the grace period ends.`,
      link: `/leave/od-proof/${doc.id}`,
      entityType: "leaveOdProofReminder",
      entityId: doc.id,
      dedupeKey: `od-proof-reminder-24h:${collegeId}:${doc.id}`,
      // A plain reminder, not a workflow item with an owner/approval step.
      actionable: false,
    });
    notified++;
  }
  return notified;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Notifications are PAUSED for cost optimization.
  return NextResponse.json({
    status: "paused",
    message: "OD proof reminders sweep is paused for cost optimization.",
    collegesChecked: 0,
    requestersNotified: 0,
  });
}
