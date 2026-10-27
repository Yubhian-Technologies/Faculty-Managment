export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";

// Which delegated duties the caller actually holds, in ONE round trip, so the
// sidebar can show the tabs that only make sense for an assigned person
// (Timetable Incharge, Question Bank, section Students / Lab Batches) instead of
// listing them for every faculty member. Each check is a single-document
// existence query (limit 1) and they run in parallel, so the cost is a handful
// of index reads however large the college is. Navigation only - the pages'
// own APIs still enforce who may see or change data.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "COLLEGE_STAFF", "HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const memberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    const ids = memberId === session.uid ? [session.uid] : [session.uid, memberId];

    const [incharge, section, teaches, inBank] = await Promise.all([
      college.collection("timetableIncharges").where("uid", "==", session.uid).limit(1).get(),
      // Section.facultyInchargeUid holds the login uid or, in older data, the faculty record id.
      college.collection("sections").where("facultyInchargeUid", "in", ids).limit(1).get(),
      // Question Bank: anyone who teaches (the Exam Cell's deadline opens their subjects
      // there), or anyone a colleague's bank covers.
      college.collection("teachingAssignments").where("facultyId", "==", memberId).limit(1).get(),
      college.collection("midQuestionBanks").where("viewerFacultyIds", "array-contains", memberId).limit(1).get(),
    ]);

    return NextResponse.json(
      { timetableIncharge: !incharge.empty, sectionIncharge: !section.empty, questionBank: !teaches.empty || !inBank.empty },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/my-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
