export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { loadResultRules } from "@/lib/examResults/store";
import { buildStudentResults } from "@/lib/examResults/studentResults";
import { loadPublishedSittings } from "@/lib/examResults/studentSittings";

// The signed-in student's own semester results - always resolved from
// session.uid, never an id from the client. Only PUBLISHED results of
// PUBLISHED sheets are returned: a draft is the Exam Cell's alone, and a sheet
// whose publish was interrupted part-way is not shown until it completes.

export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const own = await findOwnStudent(db, session.collegeId, session.uid);
    if (!own.ok) {
      return NextResponse.json({ error: "Your login is not linked to a student record yet. Please contact your College Office." }, { status: 404 });
    }
    if (passwordChangeRequired(own.student)) return passwordChangeRequiredResponse();

    const [{ rules }, sittings] = await Promise.all([
      loadResultRules(db, session.collegeId),
      loadPublishedSittings(db, session.collegeId, own.student.id),
    ]);

    return NextResponse.json({
      results: buildStudentResults(sittings, rules),
      rules: { showSgpa: rules.showSgpa, showCgpa: rules.showCgpa },
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[student/me/results GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
