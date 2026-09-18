export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodManageAssignment } from "@/lib/departments/scope";
import type { Department } from "@/types";
import type { DepartmentYearRow } from "@/lib/departments/managedBranches";

// Same two-part rule the bulk teaching-assignments DELETE applies (see
// canHodManageAssignment's own doc-comment): owns the section's
// department/year, OR owns the assigned faculty's department. This used to be
// a third, narrower reimplementation here (own department only, no child/
// managed-branch or owns-the-faculty fallback) that disagreed with both the
// bulk DELETE and the broader check assignment-creation (POST) uses - letting
// a managing HOD create an assignment for a branch's faculty they could then
// never remove through this route. Fetches the same department list POST/the
// bulk DELETE already read, since Firestore has no cheap way to answer "is X
// in the courseScopes-resolved owner list" without it.
async function assertHodOwnsAssignment(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
  assignment: { department?: string; year?: number; courseId?: string; facultyId?: string }
): Promise<boolean> {
  const scope = await getHodDepartmentScope(db, collegeId, uid);
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [deptsSnap, courseSnap] = await Promise.all([
    collegeRef.collection("departments").get(),
    assignment.courseId ? collegeRef.collection("courses").doc(assignment.courseId).get() : Promise.resolve(null),
  ]);
  const allDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as (DepartmentYearRow & Pick<Department, "name">)[];
  const catalogId = (courseSnap?.data() as { catalogId?: string } | undefined)?.catalogId;
  return canHodManageAssignment(db, collegeId, scope, allDepartments, assignment, catalogId);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      hoursPerWeek?: number;
      assignmentAcademicYear?: string;
      assignmentSemester?: string;
      passPercentage?: number | null;
      studentFeedback?: number | null;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("teachingAssignments").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (session.role === "HOD") {
      const assignmentData = snap.data() as { department?: string; year?: number; courseId?: string; facultyId?: string };
      if (!(await assertHodOwnsAssignment(db, session.collegeId, session.uid, assignmentData))) {
        return NextResponse.json({ error: "You can only edit assignments in your own department, its sub-departments, a year your department manages, or one of your own faculty's assignments elsewhere" }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.hoursPerWeek != null) updates.hoursPerWeek = Number(body.hoursPerWeek);
    if (body.assignmentAcademicYear != null) updates.assignmentAcademicYear = body.assignmentAcademicYear;
    if (body.assignmentSemester != null) updates.assignmentSemester = body.assignmentSemester;
    if (body.passPercentage != null) updates.passPercentage = Number(body.passPercentage);
    else if (body.passPercentage === null) updates.passPercentage = null;
    if (body.studentFeedback != null) updates.studentFeedback = Number(body.studentFeedback);
    else if (body.studentFeedback === null) updates.studentFeedback = null;

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[teaching-assignments/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("teachingAssignments").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (session.role === "HOD") {
      const assignmentData = snap.data() as { department?: string; year?: number; courseId?: string; facultyId?: string };
      if (!(await assertHodOwnsAssignment(db, session.collegeId, session.uid, assignmentData))) {
        return NextResponse.json({ error: "You can only remove assignments in your own department, its sub-departments, a year your department manages, or one of your own faculty's assignments elsewhere" }, { status: 403 });
      }
    }

    const slotsSnap = await collegeRef.collection("timetableSlots").where("assignmentId", "==", id).get();
    const batch = db.batch();
    slotsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[teaching-assignments/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
