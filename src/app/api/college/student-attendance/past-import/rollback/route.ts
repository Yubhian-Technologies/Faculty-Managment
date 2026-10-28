export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { applyTallyDeltaInTx } from "@/lib/studentAttendance/dayTally";
import type { StudentAttendanceSession } from "@/types";

const PER_CALL = 100; // sessions removed per request, one transaction each; the page repeats until `remaining` is 0

const millis = (t: unknown) => (t as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

// Undo for the past-attendance import: deletes the sessions that import created (tagged `importRunId`) and takes
// them back out of the student tally. A session someone edited afterwards (the Department Office corrected it)
// is left alone and reported, so a correction is never thrown away.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const body = (await readJsonBody(request)) as { runId?: string };
    const runId = body.runId?.trim();
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const snap = await db.collection("colleges").doc(collegeId).collection("studentAttendance").where("importRunId", "==", runId).get();

    const edited: string[] = [];
    const todo = snap.docs.filter((d) => {
      const s = d.data() as StudentAttendanceSession;
      if (millis(s.updatedAt) === millis(s.createdAt)) return true;
      edited.push(d.id);
      return false;
    });

    let removed = 0;
    for (const d of todo.slice(0, PER_CALL)) {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(d.ref);
        if (!fresh.exists) return;
        const s = fresh.data() as StudentAttendanceSession;
        if (s.importRunId !== runId) return;
        applyTallyDeltaInTx(tx, db, collegeId, s, { ...s, status: "DRAFT" });
        tx.delete(d.ref);
        removed++;
      });
    }
    const remaining = Math.max(0, todo.length - PER_CALL);

    const actor = (await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
    await writeAuditLogSafe(db, collegeId, {
      action: "STUDENT_ATTENDANCE_PAST_IMPORT_ROLLED_BACK",
      performedBy: session.uid,
      performedByName: actor?.name,
      details: { runId, removed, editedSinceImport: edited.length, remaining },
    });

    return NextResponse.json({ removed, remaining, editedSinceImport: edited });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/past-import/rollback POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
