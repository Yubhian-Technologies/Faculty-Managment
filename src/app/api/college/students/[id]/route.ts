export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { normalizeRosterDetails } from "@/lib/students/rosterFields";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { isConfiguredSecondaryDepartment } from "@/lib/departments/codeOrNameResolver";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { getAcademicStructure } from "@/lib/college/academicStructure";
import type { Section, StudentRecord, StudentStatus } from "@/types";

// Move a single student to a different section (roster-management fix-up -
// e.g. correcting a student who landed under the wrong one of two
// identically-named, differently-cross-listed sections) and/or remove them
// outright. Distinct from students/promote (Principal/VP-only, cohort-wide,
// forces REGULAR + a fixed target for the whole group) - this is a
// per-student correction available to whoever already manages this roster.

async function loadStudentAndScope(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
  role: string
) {
  const scope = role === "HOD" ? await getHodDepartmentScope(db, collegeId, uid) : null;
  // Only fetched when actually needed (an HOD scope exists) - a managed
  // branch (e.g. Basic Science grouping CIVIL for its shared first year) is
  // year-scoped, so "in scope" for a student depends on their year, not just
  // their department. Mirrors the students-list GET and distribute POST checks.
  let allDepts: DepartmentYearRow[] | null = null;
  // `catalogId` lets a manager that runs more than one course (e.g. sharing a
  // B.Tech's first year while also running an independent course of its own)
  // resolve ownership against the student's own course, not always the
  // manager's flat years - see catalogIdForStudent below.
  const inHodScope = (dept: string, year: number, catalogId?: string) => {
    if (!scope) return true;
    if (!allDepts) return false;
    return canHodEditDepartmentYear(scope, allDepts, dept, year, catalogId);
  };
  if (scope?.departmentName) {
    const deptsSnap = await db.collection("colleges").doc(collegeId).collection("departments").get();
    allDepts = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
  }
  return { scope, inHodScope };
}

async function catalogIdForCourseId(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  courseId: string | undefined
): Promise<string | undefined> {
  if (!courseId) return undefined;
  const snap = await db.collection("colleges").doc(collegeId).collection("courses").doc(courseId).get();
  return snap.exists ? (snap.data() as { catalogId?: string } | undefined)?.catalogId : undefined;
}

async function catalogIdForStudent(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  student: Pick<StudentRecord, "department" | "secondaryDepartment" | "section" | "year" | "courseId">
): Promise<string | undefined> {
  // Once a student has courseId (see StudentRecord.courseId's doc-comment),
  // resolve straight from it - no section lookup, no ambiguity, and no risk
  // of picking the wrong one of two same-named sections under different
  // courses. Only a legacy student without one yet falls back to the
  // name-based (ambiguity-prone) section lookup below.
  if (student.courseId) return catalogIdForCourseId(db, collegeId, student.courseId);
  const sectionDoc = await findCurrentSectionDoc(db, collegeId, student);
  const courseId = sectionDoc ? (sectionDoc.data() as { courseId?: string }).courseId : undefined;
  return catalogIdForCourseId(db, collegeId, courseId);
}

// Finds the Section doc a student is currently sitting in - only ever a
// FALLBACK for a legacy student with no `courseId` yet (the migration that
// backfills it couldn't resolve them confidently - see
// scripts/backfill-student-course-id.mjs). A shared-first-year student is
// filed under their common department (department, preserved until
// promotion) with secondaryDepartment naming their real branch instead - the
// section they're actually in is filed under THAT branch, not their own
// department (see students/[id] PATCH's write further down, and
// sections/new's managed-branch mode). Try the student's own department
// first (covers the plain and legacy-cross-listed cases, where it's already
// correct), then their secondaryDepartment.
//
// Deliberately does NOT `.limit(1)` and silently pick a winner when a
// department+name+year search matches more than one Section (two different
// courses each running a same-named section - see StudentRecord.courseId's
// doc-comment) - that used to be exactly how a student could silently
// resolve against the wrong course. Returns null (a real "current section"
// can't be determined) instead, so callers fail closed rather than guess.
async function findCurrentSectionDoc(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  student: Pick<StudentRecord, "department" | "secondaryDepartment" | "section" | "year">
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const sectionsColl = db.collection("colleges").doc(collegeId).collection("sections");
  const byOwnDept = await sectionsColl
    .where("department", "==", student.department)
    .where("name", "==", student.section)
    .where("year", "==", student.year)
    .get();
  if (byOwnDept.size === 1) return byOwnDept.docs[0];
  if (byOwnDept.size > 1) return null;
  if (!student.secondaryDepartment) return null;
  const bySecondaryDept = await sectionsColl
    .where("department", "==", student.secondaryDepartment)
    .where("name", "==", student.section)
    .where("year", "==", student.year)
    .get();
  return bySecondaryDept.size === 1 ? bySecondaryDept.docs[0] : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"
    );
    const { id } = await params;
    const body = (await request.json()) as {
      targetSectionId?: string;
      unassign?: boolean;
      secondaryDepartment?: string | null;
      rollNumber?: string;
      status?: StudentStatus;
      /** Admission details from the Office's per-student Edit form. */
      details?: Record<string, unknown>;
    };

    // Unassign: pull an already-sectioned student back to "Unassigned"
    // (section: "") without deleting them - the missing inverse of Assign
    // (targetSectionId from empty) and Move (targetSectionId to a different
    // section) below. Same role tier as the roll-number/status path (this is
    // just as much a department-structural decision), so Office and Panel
    // Member stay excluded. Every other field - roll number, department,
    // secondaryDepartment, courseId/course - is left untouched: courseId in
    // particular is deliberately NOT cleared, since it's still the student's
    // correct, best-effort intended course (StudentRecord.courseId's
    // doc-comment) even while unassigned, and re-assigning later overwrites
    // it from whichever real section they actually land in anyway. No data
    // is lost, only the section placement.
    if (body.unassign) {
      if (!["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role)) {
        return NextResponse.json(
          { error: "Only the department's HOD can unassign a student from their section" },
          { status: 403 }
        );
      }

      const db = getAdminDb();
      const collegeRef = db.collection("colleges").doc(session.collegeId);
      const studentRef = collegeRef.collection("students").doc(id);
      const studentSnap = await studentRef.get();
      if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
      const student = studentSnap.data() as StudentRecord;

      if (!student.section) {
        return NextResponse.json({ error: "This student is already unassigned" }, { status: 400 });
      }

      if (session.role === "HOD") {
        const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
        const catalogId = await catalogIdForStudent(db, session.collegeId, student);
        if (!inHodScope(student.department, student.year, catalogId)) {
          return NextResponse.json({ error: "Outside your department" }, { status: 403 });
        }
      }

      const now = new Date();
      const batch = db.batch();
      batch.update(studentRef, { section: "", updatedAt: now });
      const history = departmentHistoryEntry(db, session.collegeId, id, student.department, "", student.year, now);
      batch.set(history.ref, history.data);
      await batch.commit();

      return NextResponse.json({ ok: true });
    }

    // Roster-detail edit: the admission information the Office owns (the CSV
    // template's fields - course, admission no, contact details and so on).
    // Open to the College Office as well as the department, because this is
    // the same information the Office already enters when it imports or adds
    // the student in the first place.
    //
    // rollNumber is deliberately NOT reachable here even though it's a
    // template column: it stays on the path below, which is the department's
    // alone and is the only one that checks uniqueness. The Office can set a
    // provisional one at intake (import/add); correcting it afterwards is the
    // HOD's call.
    if (!body.targetSectionId && body.details) {
      const updates = normalizeRosterDetails(body.details);
      delete updates.rollNumber;
      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
      }

      const db = getAdminDb();
      const collegeRef = db.collection("colleges").doc(session.collegeId);
      const studentRef = collegeRef.collection("students").doc(id);
      const studentSnap = await studentRef.get();
      if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
      const student = studentSnap.data() as StudentRecord;

      if (session.role === "HOD") {
        const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
        const catalogId = await catalogIdForStudent(db, session.collegeId, student);
        if (!inHodScope(student.department, student.year, catalogId)) {
          return NextResponse.json({ error: "Outside your department" }, { status: 403 });
        }
      } else if (!["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"].includes(session.role)) {
        return NextResponse.json({ error: "Not allowed to edit student details" }, { status: 403 });
      }

      // Secondary Department, when being set to a real value (not cleared -
      // see rosterFormToPayload's writeBlanksAsNull), must actually be one
      // student.department cross-lists to - not just any real, differently-
      // named department. Same rule the bulk importer's unassigned rows and
      // the Add Student unassigned path enforce, and for the same reason:
      // without it, a student's Secondary Department can be edited to a
      // branch the department never configured, which then surfaces as a
      // bogus option wherever Secondary Department values get read back
      // (e.g. the Distribute Unassigned dialog's branch picker).
      if (typeof updates.secondaryDepartment === "string" && updates.secondaryDepartment.trim()) {
        const secondaryDept = updates.secondaryDepartment.trim();
        if (secondaryDept === student.department) {
          return NextResponse.json({ error: "Secondary Department must differ from Department" }, { status: 400 });
        }
        const deptSnap = await collegeRef.collection("departments").where("name", "==", student.department).limit(1).get();
        const deptData = deptSnap.docs[0]?.data() as
          | { secondaryDepartments?: string[]; courseScopes?: Record<string, { secondaryDepartments?: string[] }> }
          | undefined;
        if (!deptData || !isConfiguredSecondaryDepartment(deptData, secondaryDept)) {
          return NextResponse.json({ error: `"${student.department}" does not cross-list to "${secondaryDept}"` }, { status: 400 });
        }
      }

      await studentRef.update({ ...updates, updatedAt: new Date() });
      return NextResponse.json({ ok: true });
    }

    // Field-only edit (no section move): assign/correct a student's roll number
    // or status. Roll numbers are the department's responsibility - the assigned
    // HOD (years 2-4) or sub-HOD (year 1) fills them in after sectioning - so
    // this path is closed to the College Office and faculty.
    if (!body.targetSectionId) {
      if (body.rollNumber === undefined && body.status === undefined) {
        return NextResponse.json({ error: "targetSectionId is required" }, { status: 400 });
      }
      if (!["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role)) {
        return NextResponse.json(
          { error: "Only the department's HOD can set a student's roll number or status" },
          { status: 403 }
        );
      }

      const db = getAdminDb();
      const collegeRef = db.collection("colleges").doc(session.collegeId);
      const studentRef = collegeRef.collection("students").doc(id);
      const studentSnap = await studentRef.get();
      if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
      const student = studentSnap.data() as StudentRecord;

      if (session.role === "HOD") {
        const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
        const catalogId = await catalogIdForStudent(db, session.collegeId, student);
        if (!inHodScope(student.department, student.year, catalogId)) {
          return NextResponse.json({ error: "Outside your department" }, { status: 403 });
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (body.status !== undefined) {
        if (!["REGULAR", "DETAINED", "GRADUATED"].includes(body.status)) {
          return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }
        updates.status = body.status;
      }

      if (body.rollNumber !== undefined) {
        const roll = body.rollNumber.trim();
        // Roll numbers are unique within a branch + year. Skip the check when
        // clearing the roll (empty) - many roll-less students can coexist.
        if (roll) {
          const dupSnap = await collegeRef.collection("students")
            .where("rollNumber", "==", roll)
            .where("department", "==", student.department)
            .where("year", "==", student.year)
            .get();
          if (dupSnap.docs.some((d) => d.id !== id)) {
            return NextResponse.json(
              { error: `Roll number ${roll} is already used in ${student.department} Year ${student.year}` },
              { status: 400 }
            );
          }
        }
        updates.rollNumber = roll;
      }

      await studentRef.update(updates);
      return NextResponse.json({ ok: true });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentRef = collegeRef.collection("students").doc(id);

    const [studentSnap, targetSnap] = await Promise.all([
      studentRef.get(),
      collegeRef.collection("sections").doc(body.targetSectionId).get(),
    ]);
    if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (!targetSnap.exists) return NextResponse.json({ error: "Target section not found" }, { status: 404 });

    const student = studentSnap.data() as StudentRecord;
    const targetSection = { id: targetSnap.id, ...(targetSnap.data() as object) } as Section;

    if (session.role === "PANEL_MEMBER") {
      const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
      if (!targetSection.facultyInchargeUid || !candidateIds.includes(targetSection.facultyInchargeUid)) {
        return NextResponse.json({ error: "You are not in charge of the target section" }, { status: 403 });
      }
      const currentSectionDoc = await findCurrentSectionDoc(db, session.collegeId, student);
      const currentInchargeUid = currentSectionDoc?.data().facultyInchargeUid;
      if (!currentSectionDoc || !currentInchargeUid || !candidateIds.includes(currentInchargeUid)) {
        return NextResponse.json({ error: "You are not in charge of this student's current section" }, { status: 403 });
      }
    }
    if (session.role === "HOD") {
      const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
      const [fromCatalogId, toCatalogId] = await Promise.all([
        catalogIdForStudent(db, session.collegeId, student),
        catalogIdForCourseId(db, session.collegeId, targetSection.courseId),
      ]);
      if (!inHodScope(student.department, student.year, fromCatalogId) || !inHodScope(targetSection.department, targetSection.year, toCatalogId)) {
        return NextResponse.json({ error: "Outside your department" }, { status: 403 });
      }
    }

    // Same cross-listing rule as the bulk importer: only default to the
    // section's single cross-listed department, and never silently accept a
    // secondaryDepartment the target section doesn't actually offer.
    const sectionSecondaryDepts = targetSection.secondaryDepartments ?? [];
    let secondaryDept = "";
    if (body.secondaryDepartment?.trim()) {
      secondaryDept = body.secondaryDepartment.trim();
      if (!sectionSecondaryDepts.some((d) => d.toLowerCase() === secondaryDept.toLowerCase())) {
        return NextResponse.json(
          { error: `Section ${targetSection.name} is not cross-listed to "${secondaryDept}"` },
          { status: 400 }
        );
      }
    } else if (sectionSecondaryDepts.length === 1) {
      secondaryDept = sectionSecondaryDepts[0];
    } else if (sectionSecondaryDepts.length > 1) {
      return NextResponse.json(
        { error: `Section ${targetSection.name} is cross-listed to multiple departments (${sectionSecondaryDepts.join(", ")}) - specify which one` },
        { status: 400 }
      );
    }

    // Only a real roll number can clash - roll-less students (Office imports
    // before the department assigns numbers) can share a section freely.
    // Scoped by department + courseId too, not just section name + year - a
    // section name alone isn't unique (see StudentRecord.courseId's
    // doc-comment: a different department, or a different course in the SAME
    // department, can have its own same-named section), so this previously
    // could both miss a real clash and false-positive an unrelated one.
    const roll = student.rollNumber;
    if (roll) {
      const dupSnap = await collegeRef.collection("students")
        .where("rollNumber", "==", roll)
        .where("department", "==", targetSection.department)
        .where("courseId", "==", targetSection.courseId)
        .where("section", "==", targetSection.name)
        .where("year", "==", targetSection.year)
        .get();
      if (dupSnap.docs.some((d) => d.id !== id)) {
        return NextResponse.json({ error: "Roll number already exists in the target section" }, { status: 400 });
      }
    }

    // A shared-first-year student (currently filed under the college's common
    // department or one of its sub-departments - see academicStructure.ts)
    // keeps that department for their whole first year, no matter which real
    // branch's section they're placed into - only students/promote (or
    // advance-year) actually transitions them into their branch. Moving into
    // a section still filed under their OWN current department (a legacy
    // cross-listed section, or a plain non-shared department's own section)
    // is unaffected either way, since targetSection.department already
    // equals student.department there.
    const structure = await getAcademicStructure(db, session.collegeId);
    const isSharedDept = (name: string) =>
      structure.commonDepartment?.name === name || structure.subDepartments.some((sd) => sd.name === name);

    const now = new Date();
    const batch = db.batch();
    const staysInSharedDept = isSharedDept(student.department) && targetSection.department !== student.department;
    // courseId/course always mirror the section the student is actually
    // placed into now, regardless of which branch above ran - see
    // StudentRecord.courseId's doc-comment. Admission-time free text never
    // survives a real placement.
    if (staysInSharedDept) {
      batch.update(studentRef, {
        section: targetSection.name,
        year: targetSection.year,
        courseId: targetSection.courseId,
        course: targetSection.courseName ?? null,
        updatedAt: now,
      });
    } else {
      batch.update(studentRef, {
        department: targetSection.department,
        section: targetSection.name,
        year: targetSection.year,
        secondaryDepartment: secondaryDept || null,
        courseId: targetSection.courseId,
        course: targetSection.courseName ?? null,
        updatedAt: now,
      });
    }
    const history = departmentHistoryEntry(
      db, session.collegeId, id,
      staysInSharedDept ? student.department : targetSection.department,
      targetSection.name, targetSection.year, now
    );
    batch.set(history.ref, history.data);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"
    );
    const { id } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentRef = collegeRef.collection("students").doc(id);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const student = studentSnap.data() as StudentRecord;

    if (session.role === "PANEL_MEMBER") {
      const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
      const currentSectionDoc = await findCurrentSectionDoc(db, session.collegeId, student);
      const currentInchargeUid = currentSectionDoc?.data().facultyInchargeUid;
      if (!currentSectionDoc || !currentInchargeUid || !candidateIds.includes(currentInchargeUid)) {
        return NextResponse.json({ error: "You are not in charge of this student's section" }, { status: 403 });
      }
    }
    if (session.role === "HOD") {
      const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
      if (!inHodScope(student.department, student.year)) {
        return NextResponse.json({ error: "Outside your department" }, { status: 403 });
      }
    }

    const historySnap = await studentRef.collection("departmentHistory").get();
    const batch = db.batch();
    for (const h of historySnap.docs) batch.delete(h.ref);
    batch.delete(studentRef);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
