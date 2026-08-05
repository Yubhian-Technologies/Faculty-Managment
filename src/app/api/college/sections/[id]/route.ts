export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";

// A parent department's HOD has full (not just view-only) access to their
// own sub-departments' sections — same edit/delete rights as the sub-HOD who
// owns that sub-department day to day. Only a section belonging to a
// genuinely unrelated department (reached solely via `secondaryDepartments`
// cross-listing) stays out of reach here. Firestore security rules aren't in
// play here (admin SDK), so this is the only enforcement point.
async function assertHodOwnsSection(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
  sectionDepartment: string
): Promise<boolean> {
  const scope = await getHodDepartmentScope(db, collegeId, uid);
  if (scope.departmentName && scope.departmentName === sectionDepartment) return true;
  return scope.childDepartmentNames.includes(sectionDepartment);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await request.json()) as {
      courseId?: string;
      name?: string;
      year?: number;
      batch?: string;
      studentCount?: number;
      facultyInchargeUid?: string | null;
      facultyInchargeName?: string;
      departmentId?: string;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const oldSection = snap.data() as { department?: string; name?: string; year?: number };
    const sectionDept = oldSection.department ?? "";

    // Computed once and reused below for the reassignment check — avoids a
    // second getHodDepartmentScope round-trip for HOD callers moving a section.
    let hodScope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null = null;
    if (session.role === "HOD") {
      hodScope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const owns = !!hodScope.departmentName
        && (hodScope.departmentName === sectionDept || hodScope.childDepartmentNames.includes(sectionDept));
      if (!owns) {
        return NextResponse.json({ error: "You can only edit sections in your own department" }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const courseId = body.courseId ?? (snap.data() as { courseId?: string }).courseId;
    const targetYear = body.year != null ? Number(body.year) : (snap.data() as { year?: number }).year;

    let course: { name: string; durationYears: number; departmentId?: string } | null = null;
    if (courseId && (body.courseId != null || body.year != null || body.departmentId != null)) {
      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
      if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      course = courseSnap.data() as { name: string; durationYears: number; departmentId?: string };
      if (targetYear != null && (targetYear < 1 || targetYear > course.durationYears)) {
        return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears} for ${course.name}` }, { status: 400 });
      }
      if (body.courseId != null) {
        updates.courseId = courseId;
        updates.courseName = course.name;
      }
    }

    // Reassigning an existing section to a different (sub-)department — e.g.
    // a parent HOD handing a section over to a Sub-HOD to run day to day, or
    // pulling one back. Only within the caller's own department tree for an
    // HOD; Principal/VP/College Office may target any department in the college.
    if (body.departmentId != null) {
      const targetDeptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(body.departmentId).get();
      if (!targetDeptSnap.exists) return NextResponse.json({ error: "Department not found" }, { status: 404 });
      const targetDept = targetDeptSnap.data() as { name?: string; parentDepartmentId?: string; assignedYears?: number[]; secondaryDepartments?: string[] };
      const targetDeptName = targetDept.name ?? "";

      if (hodScope) {
        const allowed = body.departmentId === hodScope.departmentId || hodScope.childDepartmentIds.includes(body.departmentId);
        if (!allowed) {
          return NextResponse.json({ error: "You can only move sections within your own department or its sub-departments" }, { status: 403 });
        }
      }

      if (course && course.departmentId !== body.departmentId && course.departmentId !== targetDept.parentDepartmentId) {
        return NextResponse.json({ error: "This section's course does not belong to the selected department" }, { status: 400 });
      }

      const assignedYears = targetDept.assignedYears ?? [];
      if (targetYear != null && assignedYears.length > 0 && !assignedYears.includes(Number(targetYear))) {
        return NextResponse.json({ error: `"${targetDeptName}" is not assigned to teach Year ${targetYear}` }, { status: 400 });
      }

      const availableSecondaryDepts = targetDept.secondaryDepartments ?? [];
      updates.department = targetDeptName;
      updates.secondaryDepartments = availableSecondaryDepts.length === 1 ? [availableSecondaryDepts[0]] : [];
    }

    if (body.name != null) updates.name = body.name.trim().toUpperCase();
    if (body.year != null) updates.year = Number(body.year);
    if (body.batch != null) updates.batch = body.batch.trim();
    if (body.studentCount != null) updates.studentCount = Math.max(0, Number(body.studentCount));
    if ("facultyInchargeUid" in body) updates.facultyInchargeUid = body.facultyInchargeUid ?? null;
    if (body.facultyInchargeName != null) updates.facultyInchargeName = body.facultyInchargeName;

    const batch = new ChunkedBatch(db);
    batch.update(ref, updates);

    // Students are keyed by (department, section name, year), not by this
    // section's document id — so reassigning the section's department (or
    // renaming it / moving it to a different year) would otherwise strand
    // its already-enrolled students under the *old* identity: invisible on
    // the new roster (department mismatch), yet still blocking re-import as
    // "duplicate roll number" since that check isn't department-scoped.
    // Carry them along whenever any part of that identity actually changes.
    const newDepartment = (updates.department as string | undefined) ?? sectionDept;
    const newName = (updates.name as string | undefined) ?? (oldSection.name ?? "");
    const newYear = (updates.year as number | undefined) ?? (oldSection.year ?? 0);
    const identityChanged = newDepartment !== sectionDept || newName !== (oldSection.name ?? "") || newYear !== (oldSection.year ?? 0);

    if (identityChanged && sectionDept && oldSection.name) {
      const now = new Date();
      const enrolledSnap = await db.collection("colleges").doc(session.collegeId).collection("students")
        .where("department", "==", sectionDept)
        .where("section", "==", oldSection.name)
        .where("year", "==", oldSection.year ?? 0)
        .get();
      for (const studentDoc of enrolledSnap.docs) {
        batch.update(studentDoc.ref, { department: newDepartment, section: newName, year: newYear, updatedAt: now });
        const history = departmentHistoryEntry(db, session.collegeId, studentDoc.id, newDepartment, newName, newYear, now);
        batch.set(history.ref, history.data);
      }
    }

    await batch.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data = snap.data() as { department?: string; name?: string; year?: number };

    if (session.role === "HOD") {
      if (!(await assertHodOwnsSection(db, session.collegeId, session.uid, data.department ?? ""))) {
        return NextResponse.json({ error: "You can only delete sections in your own department" }, { status: 403 });
      }
    }

    const enrolledSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("students")
      .where("department", "==", data.department ?? "")
      .where("section", "==", data.name ?? "")
      .where("year", "==", data.year ?? 0)
      .limit(1)
      .get();
    if (!enrolledSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete a section that has students. Remove all students first." },
        { status: 409 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
