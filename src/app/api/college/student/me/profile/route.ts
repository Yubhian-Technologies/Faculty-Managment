export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { buildOwnProfileGroups } from "@/lib/students/ownProfile";
import { formatShortCourseName, toRoman } from "@/lib/academic/format";
import type { Course, Section, StudentRecord } from "@/types";

const UNLINKED_MESSAGE =
  "Your login is not linked to a student record yet. Please contact your College Office.";

const STATUS_LABEL: Record<string, string> = { REGULAR: "Regular", DETAINED: "Detained", GRADUATED: "Graduated" };

// The student's own full record, as display rows - everything the college
// holds about them EXCEPT staff-only fields (remarks, login linkage, audit
// stamps). Resolved from session.uid only; there
// is no id parameter. Never returns the raw StudentRecord.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(2).get();
    if (studentSnap.size !== 1) {
      return NextResponse.json({ error: UNLINKED_MESSAGE }, { status: 404 });
    }
    const student = { ...(studentSnap.docs[0].data() as StudentRecord), id: studentSnap.docs[0].id };
    if (passwordChangeRequired(student)) return passwordChangeRequiredResponse();

    const sectionDoc = await findCurrentSectionDoc(db, session.collegeId, student);
    const section = sectionDoc ? (sectionDoc.data() as Section) : null;
    const courseSnap = student.courseId ? await collegeRef.collection("courses").doc(student.courseId).get() : null;
    const course = courseSnap?.exists ? (courseSnap.data() as Course) : null;

    return NextResponse.json({
      header: {
        name: student.name,
        rollNumber: student.rollNumber,
        photoUrl: student.profilePhotoUrl ?? "",
        status: STATUS_LABEL[student.status] ?? student.status,
      },
      // Label/value pairs in display order; empty values are dropped.
      identity: [
        ["Roll No", student.rollNumber],
        ["Course", formatShortCourseName(course?.name ?? student.course, course?.code)],
        ["Department", student.department],
        ["Core Department", student.secondaryDepartment ?? ""],
        ["Year", student.year ? toRoman(student.year) : ""],
        ["Section", section?.name ?? student.section ?? ""],
        ["Batch", student.batch ?? ""],
        ["Regulation", student.regulation ?? ""],
        ["Lab Batch", student.labBatch ?? ""],
        ["Student Type", student.studentType ?? ""],
      ]
        .filter(([, v]) => v)
        .map(([label, value]) => ({ label, value })),
      groups: buildOwnProfileGroups(student),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/profile GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
