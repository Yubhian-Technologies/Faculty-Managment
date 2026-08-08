export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { countEntered } from "@/lib/exams/internalExamMarks";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { ExamConfiguration, InternalExamMarkEntry, InternalExamMarksBatch, Section, StudentRecord, TeachingAssignment } from "@/types";

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

    // The Exam Cell's configuration for this subject is the single source of
    // truth for what "internal marks" means here — no config, no marks entry.
    const configSnap = await collegeRef.collection("examConfigurations").doc(assignment.subjectId).get();
    if (!configSnap.exists) {
      return NextResponse.json(
        { error: "This subject's internal exam has not been configured yet. Contact your Exam Cell." },
        { status: 404 }
      );
    }
    const config = { id: configSnap.id, ...configSnap.data() } as ExamConfiguration;
    if (config.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "This subject's internal exam configuration is currently inactive. Contact your Exam Cell." },
        { status: 404 }
      );
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
    // has been migrated to real sections).
    let studentsQuery = collegeRef.collection("students")
      .where("department", "==", assignment.department)
      .where("section", "==", sectionName);
    if (year != null) studentsQuery = studentsQuery.where("year", "==", year);

    const studentsSnap = await studentsQuery.get();
    const students = studentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as StudentRecord)
      .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

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
