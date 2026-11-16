export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanAttendanceTimings, DEFAULT_ATTENDANCE_TIMINGS, lateAfterOf } from "@/lib/attendance/attendanceTimings";
import { attendanceTimingsRef, loadAttendanceTimings } from "@/lib/attendance/attendanceTimingsServer";

// The college's attendance timings for faculty and staff self check-in: start time + grace minutes. A check-in after
// start + grace is Late (reason needed, counts towards "3 late = 0.5 CL"). Principal / VP / College Office set it;
// a change applies from the next check-in (each day keeps the cut-off it was recorded with).
const EDITORS = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE"] as const;

export async function GET() {
  try {
    const session = await requireCollegeMember(...EDITORS);
    const db = getAdminDb();
    const [timings, snap] = await Promise.all([loadAttendanceTimings(db, session.collegeId), attendanceTimingsRef(db, session.collegeId).get()]);
    const d = snap.exists ? (snap.data() as { updatedAt?: { toDate?: () => Date }; updatedByName?: string }) : null;
    return NextResponse.json({
      timings, lateAfter: lateAfterOf(timings), isDefault: !snap.exists, defaults: DEFAULT_ATTENDANCE_TIMINGS,
      updatedAt: d?.updatedAt?.toDate?.()?.toISOString() ?? null, updatedByName: d?.updatedByName ?? null,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/settings/attendance-timings GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...EDITORS);
    const body = await readJsonBody(request);
    let timings;
    try { timings = cleanAttendanceTimings(body); } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Check the timings." }, { status: 400 });
    }
    const db = getAdminDb();
    const ref = attendanceTimingsRef(db, session.collegeId);
    const before = await loadAttendanceTimings(db, session.collegeId);
    await ref.set({ ...timings, updatedAt: new Date(), updatedBy: session.uid, updatedByName: session.email ?? "" });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "ATTENDANCE_TIMINGS_CHANGED",
      performedBy: session.uid,
      performedByName: session.email,
      details: { from: { ...before, lateAfter: lateAfterOf(before) }, to: { ...timings, lateAfter: lateAfterOf(timings) } },
    });
    return NextResponse.json({ timings, lateAfter: lateAfterOf(timings) });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/settings/attendance-timings PUT]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
