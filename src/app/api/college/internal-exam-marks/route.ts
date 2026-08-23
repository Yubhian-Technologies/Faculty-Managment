export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { countEntered, examConfigId, resolveExamTypeForSubject } from "@/lib/exams/internalExamMarks";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { getHodDepartmentScope, editableDepartmentNames } from "@/lib/departments/scope";
import type { ExamConfiguration, InternalExamMarkEntry, InternalExamMarksBatch, Section, StudentRecord, TeachingAssignment } from "@/types";

// HOD/Principal/VP/Super Admin oversight — view-only for everyone here (write
// access, for Principal/VP/Super Admin only, is on PATCH /[id] below). HOD is
// scoped to SUBMITTED marks within their own department + sub-departments,
// same as before. Principal/VP/Super Admin get every batch institution-wide
// regardless of status, so the dashboard can also surface a "Pending" (not
// yet submitted) count — they still can't act on a DRAFT batch since editing
// is gated to status === 'SUBMITTED' in the PATCH handler either way.
// Every batch created after courseId/courseName were added to
// InternalExamMarksBatch already carries them; only a batch saved before that
// (or from a semester-scoped assignment) needs the teachingAssignments
// fallback below.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const coll = collegeRef.collection("internalExamMarks");

    let query: FirebaseFirestore.Query = coll;

    if (session.role === "HOD") {
      query = query.where("status", "==", "SUBMITTED");
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const departments = editableDepartmentNames(scope);
      if (departments.length === 0) {
        return NextResponse.json({ batches: [] });
      }
      query = query.where("department", "in", departments);
    }

    const snap = await query.get();
    const rawBatches = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InternalExamMarksBatch));

    const legacyAssignmentIds = [...new Set(rawBatches.filter((b) => !b.courseId).map((b) => b.assignmentId))];
    const legacySnaps = await Promise.all(
      legacyAssignmentIds.map((aid) => collegeRef.collection("teachingAssignments").doc(aid).get())
    );
    const legacyByAssignmentId = new Map(
      legacySnaps
        .filter((s) => s.exists)
        .map((s) => {
          const a = s.data() as TeachingAssignment;
          return [s.id, { courseId: a.courseId ?? "", courseName: a.courseName ?? "" }];
        })
    );

    const batches = rawBatches
      .map((b) => (b.courseId ? b : { ...b, ...(legacyByAssignmentId.get(b.assignmentId) ?? { courseId: "", courseName: "" }) }))
      .sort((a, b) => (a.subjectName ?? "").localeCompare(b.subjectName ?? ""));

    return NextResponse.json({ batches });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/internal-exam-marks GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const body = (await request.json()) as { assignmentId?: string };
    const assignmentId = body.assignmentId?.trim();

    if (!assignmentId) {
      return NextResponse.json({ error: "assignmentId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Only load a subject this faculty member is currently (not historically)
    // assigned to teach — prevents loading an arbitrary assignment's roster.
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) {
      return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    }
    const assignment = assignmentSnap.data() as TeachingAssignment;
    // teachingAssignments.facultyId is the facultyMembers doc id, not the
    // login uid (see resolveFacultyMemberId) — resolve before comparing.
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    if (assignment.facultyId !== facultyMemberId || assignment.isPast) {
      return NextResponse.json({ error: "You are not assigned to teach this subject" }, { status: 403 });
    }

    // Two independent teachingAssignments shapes (see TeachingAssignment):
    // course/section-scoped ones link to a real Section doc; semester-scoped
    // ones (HOD's "Teaching Assignments" page) only carry a free-text section
    // name, with no Section doc and no course "year" to resolve.
    let sectionId: string | undefined;
    let sectionName: string;
    let year: number | undefined;

    if (assignment.sectionId) {
      const sectionSnap = await collegeRef.collection("sections").doc(assignment.sectionId).get();
      if (!sectionSnap.exists) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }
      const section = sectionSnap.data() as Section;
      sectionId = assignment.sectionId;
      sectionName = section.name;
      year = section.year;
    } else {
      sectionName = assignment.section?.trim() || "Section";
    }

    // The Exam Cell's configuration for this course+year (shared by every
    // subject taught under it) is the single source of truth for what
    // "internal marks" means here — no config, no marks entry. A semester-
    // scoped assignment has no courseId/year to resolve one by (it was never
    // reachable from the Exam Cell's Course→Year→Branch selector either).
    if (!assignment.courseId || year == null) {
      return NextResponse.json(
        { error: "This subject's internal exam has not been configured yet. Contact your Exam Cell." },
        { status: 404 }
      );
    }
    const examType = await resolveExamTypeForSubject(collegeRef, assignment.subjectId);
    const configSnap = await collegeRef.collection("examConfigurations").doc(examConfigId(assignment.courseId, year, examType)).get();
    if (!configSnap.exists) {
      return NextResponse.json(
        { error: "This course/year/branch's internal exam has not been configured yet. Contact your Exam Cell." },
        { status: 404 }
      );
    }
    const config = { id: configSnap.id, ...configSnap.data() } as ExamConfiguration;
    if (config.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "This course/year/branch's internal exam configuration is currently inactive. Contact your Exam Cell." },
        { status: 404 }
      );
    }

    // One batch per assignment (== per faculty+section+subject) — the config
    // itself (not the batch) owns the marks structure, so there's no longer a
    // separate "exam sitting" to distinguish batches by.
    const id = assignmentId;
    const ref = collegeRef.collection("internalExamMarks").doc(id);
    const now = new Date();

    const existingSnap = await ref.get();

    // Current roster, ordered for a stable S.No. column. Section-scoped
    // assignments resolve to a real section (department+section+year); the
    // semester-scoped shape has no course "year" to filter by, so it matches
    // on department+section name alone (best-effort until this college's data
    // has been migrated to real sections). A shared-first-year student in
    // this section stays filed under their common department (preserved
    // until promotion) with secondaryDepartment naming this section's real
    // branch instead - matched separately and merged, or the roster (and
    // therefore marks entry for the whole class) would come up empty. Also
    // scoped by `courseId` - guaranteed non-null here (the check above
    // already rejected a missing one) - a department can run a same-named
    // section under more than one course (StudentRecord.courseId's
    // doc-comment), and without this, marks entry could pull the wrong
    // course's roster entirely.
    let primaryQuery = collegeRef.collection("students")
      .where("department", "==", assignment.department)
      .where("section", "==", sectionName)
      .where("courseId", "==", assignment.courseId);
    let secondaryQuery = collegeRef.collection("students")
      .where("secondaryDepartment", "==", assignment.department)
      .where("section", "==", sectionName)
      .where("courseId", "==", assignment.courseId);
    if (year != null) {
      primaryQuery = primaryQuery.where("year", "==", year);
      secondaryQuery = secondaryQuery.where("year", "==", year);
    }

    const [primarySnap, secondarySnap] = await Promise.all([primaryQuery.get(), secondaryQuery.get()]);
    const seenStudentIds = new Set<string>();
    const students: StudentRecord[] = [];
    for (const d of [...primarySnap.docs, ...secondarySnap.docs]) {
      if (seenStudentIds.has(d.id)) continue;
      seenStudentIds.add(d.id);
      students.push({ id: d.id, ...d.data() } as StudentRecord);
    }
    students.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

    if (!existingSnap.exists) {
      const entries: InternalExamMarkEntry[] = students.map((s) => ({
        studentId: s.id,
        rollNumber: s.rollNumber,
        name: s.name,
        componentMarks: {},
      }));

      const batch = {
        collegeId: session.collegeId,
        department: assignment.department,
        assignmentId,
        ...(sectionId ? { sectionId } : {}),
        sectionName,
        ...(year != null ? { year } : {}),
        courseId: assignment.courseId,
        courseName: assignment.courseName ?? "",
        subjectId: assignment.subjectId,
        subjectName: assignment.subjectName,
        subjectCode: assignment.subjectCode,
        facultyId: session.uid,
        facultyName: assignment.facultyName ?? "",
        status: "DRAFT" as const,
        entries,
        totalStudents: entries.length,
        enteredCount: 0,
        submittedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(batch);
      return NextResponse.json({ batch: { id, ...batch }, configuration: config }, { status: 201 });
    }

    const existing = existingSnap.data() as InternalExamMarksBatch;

    // Roster may have changed since the batch was created (student added/moved
    // section) — reconcile while still a draft, preserving marks already
    // entered for students who are still in the section. Once submitted, the
    // batch is a locked record and is returned exactly as-is.
    if (existing.status === "DRAFT") {
      const existingByStudent = new Map(existing.entries.map((e) => [e.studentId, e]));
      const entries: InternalExamMarkEntry[] = students.map((s) => ({
        studentId: s.id,
        rollNumber: s.rollNumber,
        name: s.name,
        componentMarks: existingByStudent.get(s.id)?.componentMarks ?? {},
      }));
      const enteredCount = countEntered(entries, config);

      await ref.update({
        entries,
        totalStudents: entries.length,
        enteredCount,
        updatedAt: now,
      });

      return NextResponse.json({
        batch: { ...existing, id, entries, totalStudents: entries.length, enteredCount },
        configuration: config,
      });
    }

    return NextResponse.json({ batch: { ...existing, id }, configuration: config });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/internal-exam-marks POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
