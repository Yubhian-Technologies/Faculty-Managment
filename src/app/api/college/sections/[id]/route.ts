export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment, canHodEditDepartmentId } from "@/lib/departments/scope";
import { resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import type { DepartmentCourseScope } from "@/types";

// A parent department's HOD has full (not just view-only) access to their own
// sub-departments' sections, and a sub-HOD has the same over every branch
// grouped/managed under them (e.g. a Basic Science sub-HOD who runs CSE's
// first-year sections) - same edit/delete rights as on their own department.
// canHodEditDepartment centralizes that rule (own + child + managed); only a
// section reached solely via `secondaryDepartments` cross-listing stays
// view-only. Firestore security rules aren't in play here (admin SDK), so this
// is the only enforcement point.
//
// A managed branch is only actually owned by the managing (sub-)HOD for the
// YEARS that relationship covers (e.g. CIVIL under BS-English, for the shared
// first year only) - Year 2 onward stays with CIVIL's own dedicated HOD, even
// though the department name matches. canHodEditDepartment alone can't tell
// the two apart since it only looks at the name, so resolveBranchYearOwner
// disambiguates using the section's year - mirrors sections GET's own check.
async function assertHodOwnsSection(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  scope: Awaited<ReturnType<typeof getHodDepartmentScope>>,
  sectionDepartment: string,
  sectionYear: number
): Promise<boolean> {
  if (!canHodEditDepartment(scope, sectionDepartment)) return false;
  const deptsSnap = await db.collection("colleges").doc(collegeId).collection("departments").get();
  const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
  const owner = resolveBranchYearOwner(departments, sectionDepartment, sectionYear);
  return owner === scope.departmentName || scope.childDepartmentNames.includes(owner);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // HOD-managed (own dept + sub-departments + managed branches); Super Admin
    // override. Ownership within the HOD's tree is enforced further below.
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN");
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
      secondaryDepartment?: string | null;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const oldSection = snap.data() as { department?: string; name?: string; year?: number };
    const sectionDept = oldSection.department ?? "";
    const sectionYear = oldSection.year ?? 0;

    // Computed once and reused below for the reassignment check - avoids a
    // second getHodDepartmentScope round-trip for HOD callers moving a section.
    let hodScope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null = null;
    if (session.role === "HOD") {
      hodScope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!(await assertHodOwnsSection(db, session.collegeId, hodScope, sectionDept, sectionYear))) {
        return NextResponse.json({ error: "You can only edit sections in your own department" }, { status: 403 });
      }
    }

    // A section's year is fixed once it's created - moving its enrolled
    // cohort to the next year is a promotion, not a field edit. Without this,
    // an HOD could bump e.g. a Basic Science Year-1 section straight to
    // "Year 2" in place, even though Basic Science (a shared first-year
    // department) was never assigned to teach Year 2 at all - its real
    // Year-2 cohort belongs in each branch's own dedicated section instead.
    // Super Admin keeps the override, for support-driven data correction.
    if (session.role === "HOD" && body.year != null && Number(body.year) !== sectionYear) {
      return NextResponse.json(
        { error: "A section's year can't be changed after it's created." },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const courseId = body.courseId ?? (snap.data() as { courseId?: string }).courseId;
    const targetYear = body.year != null ? Number(body.year) : (snap.data() as { year?: number }).year;

    let course: { name: string; durationYears: number; departmentId?: string; catalogId?: string } | null = null;
    if (courseId && (body.courseId != null || body.year != null || body.departmentId != null)) {
      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
      if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      course = courseSnap.data() as { name: string; durationYears: number; departmentId?: string; catalogId?: string };
      if (targetYear != null && (targetYear < 1 || targetYear > course.durationYears)) {
        return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears} for ${course.name}` }, { status: 400 });
      }
      // Also must be a year this section's OWNING department is actually
      // assigned to teach for this specific course (Department.courseScopes,
      // resolved per the course's catalogId) - narrower than the course's raw
      // duration whenever a per-course override applies, e.g. switching a
      // section from a department's Bachelor of Technology (years 2-4) to its
      // independent Master of Technology (years 1-2 only) while the section's
      // fixed year is 3. Only checked against the section's own department -
      // the departmentId-reassignment block below validates the target
      // department separately when that's also changing.
      if (targetYear != null && sectionDept) {
        const deptSnap = await db.collection("colleges").doc(session.collegeId)
          .collection("departments").where("name", "==", sectionDept).limit(1).get();
        if (!deptSnap.empty) {
          const deptDoc = deptSnap.docs[0].data() as
            { assignedYears?: number[]; secondaryDepartments?: string[]; courseScopes?: Record<string, DepartmentCourseScope> };
          const allowedYears = resolveDepartmentCourseScope(deptDoc, course.catalogId).assignedYears;
          if (allowedYears.length > 0 && !allowedYears.includes(targetYear)) {
            return NextResponse.json(
              { error: `"${sectionDept}" is not assigned to teach Year ${targetYear} for ${course.name}` },
              { status: 400 }
            );
          }
        }
      }
      if (body.courseId != null) {
        updates.courseId = courseId;
        updates.courseName = course.name;
      }
    }

    // Reassigning an existing section to a different (sub-)department - e.g.
    // a parent HOD handing a section over to a Sub-HOD to run day to day, or
    // pulling one back. Only within the caller's own department tree for an
    // HOD; Principal/VP/College Office may target any department in the college.
    if (body.departmentId != null) {
      const targetDeptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(body.departmentId).get();
      if (!targetDeptSnap.exists) return NextResponse.json({ error: "Department not found" }, { status: 404 });
      const targetDept = targetDeptSnap.data() as {
        name?: string; parentDepartmentId?: string; assignedYears?: number[];
        secondaryDepartments?: string[]; courseScopes?: Record<string, DepartmentCourseScope>;
      };
      const targetDeptName = targetDept.name ?? "";

      if (hodScope && !canHodEditDepartmentId(hodScope, body.departmentId)) {
        return NextResponse.json({ error: "You can only move sections within your own department or its sub-departments" }, { status: 403 });
      }

      if (course && course.departmentId !== body.departmentId && course.departmentId !== targetDept.parentDepartmentId) {
        return NextResponse.json({ error: "This section's course does not belong to the selected department" }, { status: 400 });
      }

      // Per-course override aware (resolveDepartmentCourseScope), not a direct
      // `assignedYears` read - a target department with a per-course override
      // (e.g. an independent M.Tech run on different years than its shared
      // B.Tech) needs THIS course's own override, not always its flat years.
      const assignedYears = resolveDepartmentCourseScope(targetDept, course?.catalogId).assignedYears;
      if (targetYear != null && assignedYears.length > 0 && !assignedYears.includes(Number(targetYear))) {
        return NextResponse.json({ error: `"${targetDeptName}" is not assigned to teach Year ${targetYear}` }, { status: 400 });
      }

      const availableSecondaryDepts = targetDept.secondaryDepartments ?? [];
      updates.department = targetDeptName;
      updates.secondaryDepartments = availableSecondaryDepts.length === 1 ? [availableSecondaryDepts[0]] : [];
    }

    // Explicit target-branch (secondary department) change from the Edit Section
    // branch picker. The owning department must actually cross-list to the
    // chosen branch (Department.secondaryDepartments) - mirrors the POST
    // validation in sections/route.ts. An explicit choice overrides the
    // auto-derive from the departmentId block above; "" / null clears it.
    if (body.secondaryDepartment !== undefined) {
      const chosen = body.secondaryDepartment?.trim() ?? "";
      if (chosen) {
        const ownerName = (updates.department as string | undefined) ?? sectionDept;
        const ownerSnap = await db.collection("colleges").doc(session.collegeId)
          .collection("departments").where("name", "==", ownerName).limit(1).get();
        const ownerData = ownerSnap.empty
          ? undefined
          : (ownerSnap.docs[0].data() as { secondaryDepartments?: string[]; parentDepartmentId?: string });
        // Own configured branches, or a sub-department's inherited parent branches.
        let available = ownerData?.secondaryDepartments ?? [];
        if (available.length === 0 && ownerData?.parentDepartmentId) {
          const parentSnap = await db.collection("colleges").doc(session.collegeId)
            .collection("departments").doc(ownerData.parentDepartmentId).get();
          available = (parentSnap.data() as { secondaryDepartments?: string[] } | undefined)?.secondaryDepartments ?? [];
        }
        if (!available.includes(chosen)) {
          return NextResponse.json(
            { error: `"${chosen}" is not one of this department's configured secondary departments` },
            { status: 400 }
          );
        }
        updates.secondaryDepartments = [chosen];
      } else {
        updates.secondaryDepartments = [];
      }
    }

    if (body.name != null) updates.name = body.name.trim().toUpperCase();
    if (body.year != null) updates.year = Number(body.year);
    if (body.batch != null) updates.batch = body.batch.trim();
    if (body.studentCount != null) updates.studentCount = Math.max(0, Number(body.studentCount));
    if ("facultyInchargeUid" in body) {
      // See sections/route.ts POST - the picker supplies a FacultyMember doc
      // id, but this field is read by comparing against the login uid.
      updates.facultyInchargeUid = body.facultyInchargeUid
        ? await resolveLoginUidForFacultyMember(db, session.collegeId, body.facultyInchargeUid)
        : null;
    }
    if (body.facultyInchargeName != null) updates.facultyInchargeName = body.facultyInchargeName;

    // Same identity rule as create (sections/route.ts POST): renaming or moving
    // a section must not land it on top of an existing one - department + course
    // + year + name + cross-listed branch. Skips itself.
    const finalDepartment = (updates.department as string | undefined) ?? sectionDept;
    const finalName = (updates.name as string | undefined) ?? (oldSection.name ?? "");
    const finalYear = (updates.year as number | undefined) ?? (oldSection.year ?? 0);
    const finalCourseId = (updates.courseId as string | undefined) ?? (snap.data() as { courseId?: string }).courseId ?? "";
    const finalSecondary = (
      "secondaryDepartments" in updates
        ? (updates.secondaryDepartments as string[])
        : ((snap.data() as { secondaryDepartments?: string[] }).secondaryDepartments ?? [])
    )[0]?.toLowerCase() ?? "";
    if (finalDepartment && finalCourseId && finalName) {
      const siblingSnap = await db.collection("colleges").doc(session.collegeId).collection("sections")
        .where("department", "==", finalDepartment)
        .where("courseId", "==", finalCourseId)
        .where("year", "==", finalYear)
        .get();
      const clash = siblingSnap.docs.some((d) => {
        if (d.id === id) return false;
        const s = d.data() as { name?: string; secondaryDepartments?: string[] };
        return (s.name ?? "").toUpperCase() === finalName
          && (s.secondaryDepartments?.[0] ?? "").toLowerCase() === finalSecondary;
      });
      if (clash) {
        return NextResponse.json(
          { error: `Section ${finalName} already exists for ${finalDepartment} Year ${finalYear}.` },
          { status: 409 }
        );
      }
    }

    const batch = new ChunkedBatch(db);
    batch.update(ref, updates);

    // Students are keyed by (department, section name, year), not by this
    // section's document id - so reassigning the section's department (or
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
    // HOD-managed (own dept + sub-departments + managed branches); Super Admin
    // override. Ownership within the HOD's tree is enforced further below.
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data = snap.data() as { department?: string; name?: string; year?: number; courseId?: string; secondaryDepartments?: string[] };

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!(await assertHodOwnsSection(db, session.collegeId, scope, data.department ?? "", data.year ?? 0))) {
        return NextResponse.json({ error: "You can only delete sections in your own department" }, { status: 403 });
      }
    }

    const [enrolledSnap, siblingSnap] = await Promise.all([
      db.collection("colleges").doc(session.collegeId).collection("students")
        .where("department", "==", data.department ?? "")
        .where("section", "==", data.name ?? "")
        .where("year", "==", data.year ?? 0)
        .limit(1)
        .get(),
      db.collection("colleges").doc(session.collegeId).collection("sections")
        .where("department", "==", data.department ?? "")
        .where("courseId", "==", data.courseId ?? "")
        .where("year", "==", data.year ?? 0)
        .get(),
    ]);

    // A section with students normally can't be deleted (it looks like dropping
    // an in-use class). The exception is an EXACT duplicate: students are keyed
    // by (department, section name, year), not this doc id, so an identical twin
    // still covers them - deleting the extra copy orphans nobody. So block only
    // when the section has students AND no identical twin exists. This is what
    // lets a mistakenly-created duplicate be cleaned up from the UI.
    const secondary = (data.secondaryDepartments?.[0] ?? "").toLowerCase();
    const hasTwin = siblingSnap.docs.some((d) => {
      if (d.id === id) return false;
      const s = d.data() as { name?: string; secondaryDepartments?: string[] };
      return (s.name ?? "").toUpperCase() === (data.name ?? "").toUpperCase()
        && (s.secondaryDepartments?.[0] ?? "").toLowerCase() === secondary;
    });
    if (!enrolledSnap.empty && !hasTwin) {
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
