export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { computeStudentAttendanceHistory } from "@/lib/studentAttendance/history";
import type { StudentRecord, Section } from "@/types";

const UNLINKED_MESSAGE =
  "Your login is not linked to a student record yet. Please contact your College Office.";

// Self-service "My Dashboard" for a STUDENT login - profile + own section +
// own cumulative attendance, all in one payload (all three panels are read
// together on first paint off the same session.uid lookup, unlike faculty/me
// which is genuinely one record). Never trusts a client-supplied id - the
// student is always resolved from session.uid, exactly like
// api/college/faculty/me's own self-lookup.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) {
      return NextResponse.json({ student: null, section: null, attendance: null, message: UNLINKED_MESSAGE });
    }

    const studentDoc = studentSnap.docs[0];
    const student = { ...(studentDoc.data() as StudentRecord), id: studentDoc.id };
    if (passwordChangeRequired(student)) return passwordChangeRequiredResponse();

    const sectionDoc = await findCurrentSectionDoc(db, session.collegeId, student);
    const section = sectionDoc ? ({ ...(sectionDoc.data() as Section), id: sectionDoc.id }) : null;

    const attendance = await computeStudentAttendanceHistory(db, session.collegeId, student.id, student.department);

    return NextResponse.json({ student, section, attendance });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
