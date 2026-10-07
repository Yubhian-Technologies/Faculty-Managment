export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { buildStudentSelfUpdate, studentMobileSelfEditable, STUDENT_SELF_EDITABLE_KEYS, MOBILE_LOCKED_UNTIL_ROLL_MESSAGE } from "@/lib/students/selfEdit";
import { isStudentMobileTaken, releaseStudentMobile, reserveStudentMobile } from "@/lib/students/studentMobile";
import { rosterFieldFormValue, ROSTER_FIELDS } from "@/lib/students/rosterFields";
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
      // What the student may edit and its current value (form strings) - only the editable fields, so nothing
      // office-managed travels here. The mobile number is editable once a Roll No exists (see selfEdit.ts).
      editable: {
        values: Object.fromEntries(
          ROSTER_FIELDS.filter((f) => STUDENT_SELF_EDITABLE_KEYS.includes(f.key)).map((f) => [f.key, rosterFieldFormValue(f, student)])
        ),
        mobileEditable: studentMobileSelfEditable(student),
        mobileLockedReason: studentMobileSelfEditable(student) ? "" : MOBILE_LOCKED_UNTIL_ROLL_MESSAGE,
      },
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/profile GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// A student's own edit of their own details. Only the fields in STUDENT_SELF_EDITABLE_KEYS (selfEdit.ts) - everything
// else (Roll No, name, course/department/year/section, admission, caste, Aadhar, remarks...) stays with the College
// Office and is refused here. Resolved from session.uid only. Only changed fields are written, so a stale form can't
// overwrite what the Office changed meanwhile; a changed Student Mobile No is claimed globally first (studentMobile.ts).
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const body = (await readJsonBody(request)) as { details?: unknown };
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(2).get();
    if (studentSnap.size !== 1) return NextResponse.json({ error: UNLINKED_MESSAGE }, { status: 404 });
    const studentDoc = studentSnap.docs[0];
    const student = { ...(studentDoc.data() as StudentRecord), id: studentDoc.id };
    if (passwordChangeRequired(student)) return passwordChangeRequiredResponse();

    const built = buildStudentSelfUpdate(student, body.details);
    if (!built.ok) return NextResponse.json({ error: built.error, ...(built.code ? { code: built.code } : {}) }, { status: built.status });
    if (Object.keys(built.updates).length === 0) return NextResponse.json({ ok: true, changed: [] });

    if (built.mobile) {
      try {
        await reserveStudentMobile(db, session.collegeId, built.mobile, student.id);
      } catch (mobileErr) {
        if (isStudentMobileTaken(mobileErr)) return NextResponse.json({ error: mobileErr.userMessage, code: "MOBILE_TAKEN" }, { status: 409 });
        throw mobileErr;
      }
    }
    try {
      await studentDoc.ref.update({ ...built.updates, updatedAt: new Date() });
    } catch (writeErr) {
      if (built.mobile) await releaseStudentMobile(db, session.collegeId, built.mobile, student.id);
      throw writeErr;
    }

    const changed = Object.keys(built.updates);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "STUDENT_DETAILS_UPDATED", performedBy: session.uid, performedByName: student.name, targetId: student.id,
      details: { self: true, name: student.name, rollNumber: student.rollNumber, fields: changed },
    });
    return NextResponse.json({ ok: true, changed });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/profile PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
