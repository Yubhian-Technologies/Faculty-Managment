export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { attendancePostingRef, cleanExtraMinutes, invalidatePostingExtra, MAX_EXTRA_MINUTES, postingExtraMinutes } from "@/lib/attendance/attendancePosting";

// Extra time to post student attendance after college hours (lib/attendance/attendancePosting.ts).
// GET -> { extraMinutes, canEdit }   PUT { extraMinutes } (College Admin only) -> { extraMinutes }

function fail(err: unknown, tag: string) {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}

export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "HOD");
    const extraMinutes = await postingExtraMinutes(getAdminDb(), session.collegeId);
    return NextResponse.json({ extraMinutes, canEdit: session.realRole === "COLLEGE_ADMIN" });
  } catch (err) {
    return fail(err, "settings/attendance-posting GET");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL");
    if (session.realRole !== "COLLEGE_ADMIN") {
      return NextResponse.json({ error: "Only the College Admin can set the extra posting time." }, { status: 403 });
    }
    const body = (await readJsonBody(request)) as { extraMinutes?: unknown };
    const extraMinutes = cleanExtraMinutes(body.extraMinutes);
    if (extraMinutes === null) return NextResponse.json({ error: `Enter whole minutes from 0 to ${MAX_EXTRA_MINUTES}.` }, { status: 400 });
    const db = getAdminDb();
    const before = await postingExtraMinutes(db, session.collegeId);
    const actor = ((await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? "";
    await attendancePostingRef(db, session.collegeId).set({ extraMinutes, updatedAt: new Date(), updatedBy: session.uid, updatedByName: actor }, { merge: true });
    invalidatePostingExtra(session.collegeId);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "ATTENDANCE_POSTING_TIME_CHANGED", performedBy: session.uid, performedByName: actor, targetId: "attendancePosting",
      details: { from: before, to: extraMinutes },
    });
    return NextResponse.json({ extraMinutes });
  } catch (err) {
    return fail(err, "settings/attendance-posting PUT");
  }
}
