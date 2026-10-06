export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { invalidateSectionCountCache } from "@/lib/students/sectionCounts";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { normalizeRosterDetails } from "@/lib/students/rosterFields";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, resolveFreshmanLandingDepartment, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { isConfiguredSecondaryDepartmentOrChild } from "@/lib/departments/codeOrNameResolver";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { getAcademicStructure, type DepartmentWithId } from "@/lib/college/academicStructure";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { findRollNumberConflict, rollNumberTakenMessage } from "@/lib/students/rollNumberUniqueness";
import { rollNumberUpperOf } from "@/lib/students/loginDefaults";
import { normalizeStudentMobile, studentMobileProblem, reserveStudentMobile, isStudentMobileTaken, STUDENT_MOBILE_CLEAR_MESSAGE } from "@/lib/students/studentMobile";
import { deleteStudentsCompletely } from "@/lib/students/deleteStudent";
import { StudentLoginError, setStudentLoginActive, syncStudentRollChange } from "@/lib/students/provisionLogin";
import { FieldValue } from "firebase-admin/firestore";
import { actorOf } from "@/lib/audit/actorOf";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
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

// One audit entry per roster change. Never fails the request (see writeAuditLog).
async function auditStudentChange(
  db: FirebaseFirestore.Firestore,
  session: { collegeId: string; uid: string; email?: string },
  action: string,
  student: Pick<StudentRecord, "name" | "rollNumber">,
  targetId: string,
  details: Record<string, unknown> = {}
) {
  const actor = await actorOf(db, session.collegeId, session.uid, session.email);
  await writeAuditLog(db, session.collegeId, {
    action,
    performedBy: session.uid,
    performedByName: actor.name,
    targetId,
    details: { name: student.name, rollNumber: student.rollNumber, ...details },
  });
}

// A single student's full roster record, for the Student Details page
// (src/components/students/StudentDetailsPage.tsx) - that page loads fresh
// on every visit (bookmark/refresh), so it needs its own by-id fetch rather
// than relying on a row already held in a list page's memory. Same role tier
// and HOD scope-check as PATCH below, so a details page never shows more
// than that caller could already see/act on via the list.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"
    );
    const { id } = await params;
    const db = getAdminDb();
    const studentSnap = await db.collection("colleges").doc(session.collegeId).collection("students").doc(id).get();
    if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const student = studentSnap.data() as StudentRecord;

    if (session.role === "HOD") {
      const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
      const catalogId = await catalogIdForStudent(db, session.collegeId, student);
      if (!inHodScope(student.department, student.year, catalogId)) {
        return NextResponse.json({ error: "Outside your department" }, { status: 403 });
      }
    }

    return NextResponse.json({ student: { ...student, id: studentSnap.id } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"
    );
    invalidateSectionCountCache(session.collegeId); // student counts on the Sections list change with this write
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      targetSectionId?: string;
      unassign?: boolean;
      secondaryDepartment?: string | null;
      rollNumber?: string;
      status?: StudentStatus;
      /** Which lab sub-group (e.g. "Batch 1") - see StudentRecord.labBatch. Empty string clears it. */
      labBatch?: string;
      /** Admission details from the Office's per-student Edit form. */
      details?: Record<string, unknown>;
      /** Firebase Storage URL from the Edit form's photo upload. Empty string clears it. */
      profilePhotoUrl?: string;
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
      // labBatch is a sub-group OF the section being left - carrying it into
      // "unassigned" (and on to whatever section comes next) would put the
      // student in the wrong lab roster.
      batch.update(studentRef, { section: "", labBatch: "", updatedAt: now });
      const history = departmentHistoryEntry(db, session.collegeId, id, student.department, "", student.year, now);
      batch.set(history.ref, history.data);
      await batch.commit();
      await auditStudentChange(db, session, "STUDENT_UNASSIGNED", student, id, { fromSection: student.section, year: student.year });

      return NextResponse.json({ ok: true });
    }

    // A student's photo - not a roster/CSV field (see
    // StudentRecord.profilePhotoUrl's own doc-comment), so it gets its own
    // small branch rather than being folded into `details` (which only ever
    // accepts/keeps ROSTER_DETAIL_KEYS - a bare profilePhotoUrl there would be
    // silently dropped by normalizeRosterDetails). Same role tier as the
    // roster-detail edit just below - whoever can edit this student's profile
    // at all. Checked before the targetSectionId/details branches below so a
    // photo-only request (no other field set) doesn't fall through to the
    // "targetSectionId is required" rejection further down.
    if (body.profilePhotoUrl !== undefined) {
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

      await studentRef.update({ profilePhotoUrl: body.profilePhotoUrl.trim() || null, updatedAt: new Date() });
      await auditStudentChange(db, session, "STUDENT_PHOTO_UPDATED", student, id);
      return NextResponse.json({ ok: true });
    }

    // Roster-detail edit: the admission information the Office owns (the CSV
    // template's fields - course, admission no, contact details and so on).
    // Open to the College Office as well as the department, because this is
    // the same information the Office already enters when it imports or adds
    // the student in the first place.
    //
    // rollNumber: for every role EXCEPT the College Office it is deliberately NOT
    // reachable here even though it's a template column - it stays on the path
    // below, which is the department's and is the only one that checks
    // uniqueness. The College Office may also change it from this edit form: a
    // changed roll goes through the very same rules and write as the path below
    // (can't be blanked, unique - also across colleges, the login and its roll
    // registry entry follow it), see officeRollChange.
    if (!body.targetSectionId && body.details) {
      const updates = normalizeRosterDetails(body.details);
      delete updates.rollNumber;
      const officeSentRoll = session.role === "COLLEGE_OFFICE" && body.details.rollNumber !== undefined;
      if (Object.keys(updates).length === 0 && !officeSentRoll) {
        return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
      }
      // Course is required (ROSTER_FIELDS) the same as Name/Department/Year -
      // an edit can change it to another real course, but can't clear it back
      // to blank the way an optional field's null (rosterFormToPayload's
      // writeBlanksAsNull) is otherwise allowed to.
      if (updates.course === null) {
        return NextResponse.json({ error: "Course is required" }, { status: 400 });
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

      // College Office only: a changed Roll No. The same checks as the roll-number
      // path below - never removable, and refused when another student holds it -
      // made before anything is written. The unchanged roll the form re-sends with
      // every save is a no-op (so a legacy student sharing a roll stays editable).
      let officeRollChange: { from: string; to: string } | null = null;
      if (officeSentRoll) {
        const sent = body.details.rollNumber;
        const roll = typeof sent === "string" ? sent.trim() : "";
        const currentRoll = (student.rollNumber ?? "").trim();
        if (!roll && currentRoll) {
          return NextResponse.json({ error: "A student's roll number can't be removed - change it to the correct number instead" }, { status: 400 });
        }
        if (roll && roll !== currentRoll) {
          const clash = await findRollNumberConflict(collegeRef.collection("students"), roll, id);
          if (clash) {
            return NextResponse.json({ error: rollNumberTakenMessage(roll, clash.name) }, { status: 400 });
          }
          officeRollChange = { from: currentRoll, to: roll };
        }
      }
      if (Object.keys(updates).length === 0 && !officeRollChange) {
        return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
      }

      // Student Mobile No is required: it can be CHANGED to a real 10-digit number that no other student - in this or any
      // other college - holds (stored in that 10-digit form, claimed atomically - lib/students/studentMobile.ts), but
      // never CLEARED. The value the edit form re-sends unchanged is left alone, and a legacy student saved with no number
      // yet may still be saved without one (like a legacy roll-less student) until one is entered. A claim left behind by
      // a later failure goes stale by itself.
      if ("mobileNo" in updates && updates.mobileNo === null && (student.mobileNo ?? "").toString().trim()) {
        return NextResponse.json({ error: STUDENT_MOBILE_CLEAR_MESSAGE }, { status: 400 });
      }
      if ("mobileNo" in updates && typeof updates.mobileNo === "string") {
        const typed = updates.mobileNo.trim();
        if (typed !== (student.mobileNo ?? "").toString().trim()) {
          const mobileProblem = studentMobileProblem(typed);
          if (mobileProblem) return NextResponse.json({ error: mobileProblem }, { status: 400 });
          const mobile10 = normalizeStudentMobile(typed);
          try {
            await reserveStudentMobile(db, session.collegeId, mobile10, id);
          } catch (mobileErr) {
            if (isStudentMobileTaken(mobileErr)) return NextResponse.json({ error: mobileErr.userMessage }, { status: 409 });
            throw mobileErr;
          }
          updates.mobileNo = mobile10;
        }
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
          return NextResponse.json({ error: "Core Department must differ from Department" }, { status: 400 });
        }
        const deptSnap = await collegeRef.collection("departments").where("name", "==", student.department).limit(1).get();
        const deptDoc = deptSnap.docs[0];
        const deptData = deptDoc?.data() as
          | { secondaryDepartments?: string[]; courseScopes?: Record<string, { secondaryDepartments?: string[] }>; managedDepartments?: string[] }
          | undefined;
        // `secondaryDept` may itself be a sub-department of one of the
        // owner's configured branches (e.g. "ECE-VLSI" under "Electronics and
        // Communication Engineering") - the branch being configured is
        // enough, its own sub-departments don't need to be separately,
        // individually configured too (isConfiguredSecondaryDepartmentOrChild's
        // doc-comment).
        const secondaryDeptSnap = await collegeRef.collection("departments").where("name", "==", secondaryDept).limit(1).get();
        let secondaryParentName: string | undefined;
        if (!secondaryDeptSnap.empty) {
          const secondaryParentId = (secondaryDeptSnap.docs[0].data() as { parentDepartmentId?: string }).parentDepartmentId;
          if (secondaryParentId) {
            const parentSnap = await collegeRef.collection("departments").doc(secondaryParentId).get();
            secondaryParentName = (parentSnap.data() as { name?: string } | undefined)?.name;
          }
        }
        // The owner department's own sub-departments (if it's a parent) also
        // count via THEIR managedDepartments - same fold-in the client's
        // dropdown already does (secondaryDepartmentOptions, RosterFieldInputs.tsx).
        const childDepts = deptDoc
          ? (await collegeRef.collection("departments").where("parentDepartmentId", "==", deptDoc.id).get())
              .docs.map((d) => d.data() as { managedDepartments?: string[] })
          : [];
        if (!deptData || !isConfiguredSecondaryDepartmentOrChild(deptData, secondaryDept, secondaryParentName, childDepts)) {
          return NextResponse.json({ error: `"${student.department}" does not cross-list to "${secondaryDept}"` }, { status: 400 });
        }

        // A "no own sections" shared-first-year parent (e.g. VISHNU
        // INSTITUTE OF TECHNOLOGY's "BASIC SCIENCE") never itself houses a
        // student - if student.department is one, remap it too, to whichever
        // child actually manages the newly-set Core Department, or this edit
        // would leave the student filed under the wrong sibling forever. A
        // no-op for every other department (see
        // resolveFreshmanLandingDepartment's own doc-comment).
        const allDeptsSnap = await collegeRef.collection("departments").get();
        const allDepts = allDeptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentWithId[];
        const remappedDepartment = resolveFreshmanLandingDepartment(allDepts, student.department, secondaryDept);
        if (remappedDepartment !== student.department) {
          updates.department = remappedDepartment;
          const now = new Date();
          const history = departmentHistoryEntry(db, session.collegeId, id, remappedDepartment, student.section ?? "", student.year, now);
          if (officeRollChange) {
            // The roll change and the detail updates are ONE write (syncStudentRollChange);
            // the history entry follows it.
            try {
              await syncStudentRollChange(db, await getAdminAuth(), session.collegeId, id, student, officeRollChange.to, { ...updates, updatedAt: now });
            } catch (err) {
              if (err instanceof StudentLoginError) return NextResponse.json({ error: err.message }, { status: err.status });
              throw err;
            }
            await history.ref.set(history.data);
            await auditStudentChange(db, session, "STUDENT_ROLL_CHANGED", student, id, { from: officeRollChange.from, to: officeRollChange.to });
          } else {
            const batch = db.batch();
            batch.update(studentRef, { ...updates, updatedAt: now });
            batch.set(history.ref, history.data);
            await batch.commit();
          }
          await auditStudentChange(db, session, "STUDENT_DETAILS_UPDATED", student, id, { fields: Object.keys(updates), remappedDepartment });
          return NextResponse.json({ ok: true });
        }
      }

      if (officeRollChange) {
        // The roll is the student's login name and is unique across ALL colleges:
        // claimed globally, the login's email and lookup follow it, the old roll is
        // retired - together with this edit's other fields, in one write.
        try {
          await syncStudentRollChange(db, await getAdminAuth(), session.collegeId, id, student, officeRollChange.to, { ...updates, updatedAt: new Date() });
        } catch (err) {
          if (err instanceof StudentLoginError) return NextResponse.json({ error: err.message }, { status: err.status });
          throw err;
        }
        await auditStudentChange(db, session, "STUDENT_ROLL_CHANGED", student, id, { from: officeRollChange.from, to: officeRollChange.to });
      } else {
        await studentRef.update({ ...updates, updatedAt: new Date() });
      }
      await auditStudentChange(db, session, "STUDENT_DETAILS_UPDATED", student, id, { fields: Object.keys(updates) });
      return NextResponse.json({ ok: true });
    }

    // Field-only edit (no section move): assign/correct a student's roll number,
    // status, or lab batch. Roll number and status are the department's
    // responsibility - the assigned HOD (years 2-4) or sub-HOD (year 1) fills
    // them in after sectioning - so those two stay closed to the College
    // Office and faculty. Lab Batch (see StudentRecord.labBatch's own
    // doc-comment) is different: dividing a section's own students into lab
    // sub-groups is squarely the Faculty Incharge's own business, so it's also
    // open to a PANEL_MEMBER, but ONLY for a lab-batch-only request (checked
    // just below) and only for a student in a section they're actually in
    // charge of (checked further down, once the student doc is loaded) - see
    // panel/students/batches/page.tsx.
    if (!body.targetSectionId) {
      if (body.rollNumber === undefined && body.status === undefined && body.labBatch === undefined) {
        return NextResponse.json({ error: "targetSectionId is required" }, { status: 400 });
      }
      const isLabBatchOnly = body.rollNumber === undefined && body.status === undefined && body.labBatch !== undefined;
      if (
        !["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role)
        && !(session.role === "PANEL_MEMBER" && isLabBatchOnly)
      ) {
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
      } else if (session.role === "PANEL_MEMBER") {
        const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
        const currentSectionDoc = await findCurrentSectionDoc(db, session.collegeId, student);
        const currentInchargeUid = currentSectionDoc?.data().facultyInchargeUid;
        if (!currentSectionDoc || !currentInchargeUid || !candidateIds.includes(currentInchargeUid)) {
          return NextResponse.json({ error: "You are not in charge of this student's section" }, { status: 403 });
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      let revertedGraduation = false;

      if (body.status !== undefined) {
        if (!["REGULAR", "DETAINED", "GRADUATED"].includes(body.status)) {
          return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }
        // Graduating records WHEN, from WHICH batch and course - only Promotion's
        // Graduate action captures those (students/promote). A bare status flip
        // here would create a graduate with none of it.
        if (body.status === "GRADUATED") {
          if (student.status !== "GRADUATED") {
            return NextResponse.json(
              { error: "Use Promotion > Graduate to graduate students - it records their batch and course" },
              { status: 400 }
            );
          }
        } else if (student.status === "GRADUATED") {
          // Undoing a graduation: office-level, and it must also drop the graduation
          // snapshot (it would otherwise haunt the record) and give the login back.
          if (!["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role)) {
            return NextResponse.json({ error: "Only the Principal can undo a graduation" }, { status: 403 });
          }
          revertedGraduation = true;
          updates.graduatedAt = FieldValue.delete();
          updates.graduationBatch = FieldValue.delete();
          updates.graduationCourseId = FieldValue.delete();
          updates.graduationCourseName = FieldValue.delete();
        }
        updates.status = body.status;
      }

      let rollChange: { from: string; to: string } | null = null;
      if (body.rollNumber !== undefined) {
        const roll = body.rollNumber.trim();
        const currentRoll = (student.rollNumber ?? "").trim();
        // The roll number is the student's unique identity - it can be
        // corrected to another free number but never removed. A student who
        // has none yet (legacy import) may be saved with it still blank: the
        // edit dialog re-sends the empty value along with a status / lab-batch
        // change, and that must not be blocked.
        if (!roll && currentRoll) {
          return NextResponse.json({ error: "A student's roll number can't be removed - change it to the correct number instead" }, { status: 400 });
        }
        // Roll numbers are unique across the whole college (like a faculty
        // member's employee id), compared case-insensitively. Only checked when
        // the roll is actually CHANGING: the edit dialog re-sends the current
        // roll along with a status / lab-batch change, and a student who
        // already shares a roll with someone (data saved before this rule) must
        // still be editable without first having to change it.
        if (roll && roll !== currentRoll) {
          const clash = await findRollNumberConflict(collegeRef.collection("students"), roll, id);
          if (clash) {
            return NextResponse.json({ error: rollNumberTakenMessage(roll, clash.name) }, { status: 400 });
          }
          rollChange = { from: currentRoll, to: roll };
        } else {
          updates.rollNumber = roll;
          // Opportunistically stamp the case-insensitive key on a document that predates it.
          if (roll) updates.rollNumberUpper = rollNumberUpperOf(roll);
        }
      }

      if (body.labBatch !== undefined) {
        updates.labBatch = body.labBatch.trim();
      }

      try {
        if (rollChange) {
          // The roll is the student's login name and is unique across ALL colleges:
          // the new roll is claimed globally, the login's email and lookup follow it,
          // and the old roll is retired - see syncStudentRollChange.
          await syncStudentRollChange(db, await getAdminAuth(), session.collegeId, id, student, rollChange.to, updates);
        } else {
          await studentRef.update(updates);
        }
      } catch (err) {
        const badBody = badBodyResponse(err);
        if (badBody) return badBody;
        if (err instanceof StudentLoginError) return NextResponse.json({ error: err.message }, { status: err.status });
        throw err;
      }

      if (revertedGraduation && student.uid) {
        await setStudentLoginActive(db, await getAdminAuth(), session.collegeId, student.uid, true);
      }

      if (rollChange) await auditStudentChange(db, session, "STUDENT_ROLL_CHANGED", student, id, { from: rollChange.from, to: rollChange.to });
      if (body.status !== undefined && body.status !== student.status) {
        await auditStudentChange(db, session, revertedGraduation ? "STUDENT_GRADUATION_UNDONE" : "STUDENT_STATUS_CHANGED", student, id, { from: student.status, to: body.status });
      }
      if (body.labBatch !== undefined && body.labBatch.trim() !== (student.labBatch ?? "")) {
        await auditStudentChange(db, session, "STUDENT_LAB_BATCH_UPDATED", student, id, { from: student.labBatch ?? "", to: body.labBatch.trim() });
      }
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
        // A lab batch belongs to the section it was set in - never carried into another.
        labBatch: "",
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
        labBatch: "",
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
    await auditStudentChange(db, session, "STUDENT_SECTION_CHANGED", student, id, {
      fromSection: student.section || "", toSection: targetSection.name, toDepartment: targetSection.department, year: targetSection.year,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Deleting a student is permanent and complete (see lib/students/deleteStudent.ts):
// the record, its department history, their login and their roll number's registry
// entry are all removed - nothing is archived. Whoever could delete before still can:
// the HOD of the student's department, the Principal/Vice Principal/Office, and the
// faculty member in charge of the student's section.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"
    );
    invalidateSectionCountCache(session.collegeId); // student counts on the Sections list change with this write
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

    const { failedIds } = await deleteStudentsCompletely(db, getAdminAuth, session.collegeId, [studentSnap]);
    if (failedIds.length > 0) {
      return NextResponse.json({ error: "Could not delete the student's login - nothing was deleted, please try again" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
