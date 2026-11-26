export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { missedPeriods } from "@/lib/studentAttendance/lateMarkServer";

// GET: the caller's own missed classes for Late Marking (lib/studentAttendance/lateMark.ts) - periods of today and
// the college's Late Marking days whose posting window closed and were never submitted, each with the reason it
// can't be marked late, when it can't. Marking itself goes through the usual POST / PATCH student-attendance with
// `lateMark: { reason }`.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const db = getAdminDb();
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    const { days, periods } = await missedPeriods(db, session.collegeId, { uid: session.uid, facultyMemberId });
    const college = db.collection("colleges").doc(session.collegeId);
    const ids = [...new Set(periods.map((p) => p.sectionId).filter(Boolean))];
    const names = new Map(
      (ids.length ? await db.getAll(...ids.map((id) => college.collection("sections").doc(id))) : [])
        .map((s) => [s.id, String((s.data() as { name?: string } | undefined)?.name ?? "")]),
    );
    return NextResponse.json({ days, periods: periods.map((p) => ({ ...p, sectionName: names.get(p.sectionId) ?? "" })) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/student-attendance/late-mark GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
