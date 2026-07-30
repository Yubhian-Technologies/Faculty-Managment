// Unifies every source of "who teaches what" into one flat table shape — the
// live current teaching assignments (course/section-scoped, from the Teaching
// Assignments module), the Module 2 static course summary, and Module 8's
// past/present tenure records (academic year/semester, past ones carry a pass %).
// Used by both the resume (src/lib/pdf/resumeTemplate.ts) and the Edit Faculty
// Details page (TeachingLoadTable) so the two always show the same rows.

export interface TeachingLoadRow {
  academicYear?: string;
  courseName?: string;
  year?: number; // which year/class within the course
  section?: string;
  semester?: string | number;
  subject?: string;
  hoursPerWeek?: number;
  passPercentage?: number;
}

interface CurrentAssignmentLike {
  courseName?: string;
  year?: number;
  sectionName?: string;
  subjectName?: string;
  subjectCode?: string;
  hoursPerWeek?: number;
  // Every assignment (current or past) carries which academic year/semester it
  // belongs to. `isPast` additionally marks a structured past teaching assignment
  // (added via "Add Past Teaching Assignment" in the Current Teaching Assignments
  // editor) — distinct from the free-text Module 8 tenure records below, but shown
  // in the same table — which is the only thing that unlocks `passPercentage`.
  assignmentAcademicYear?: string;
  assignmentSemester?: string;
  isPast?: boolean;
  passPercentage?: number;
}

interface StaticCourseLike {
  code?: string;
  name?: string;
  weeklyCreditHours?: number;
}

interface TenurePresentLike {
  academicYear?: string;
  semester?: string;
  subject?: string;
}

interface TenurePastLike extends TenurePresentLike {
  studentPassPercentage?: number;
}

export function buildTeachingLoadRows(input: {
  currentAssignments?: CurrentAssignmentLike[];
  staticCourses?: StaticCourseLike[];
  tenurePresentRecords?: TenurePresentLike[];
  tenurePastRecords?: TenurePastLike[];
}): TeachingLoadRow[] {
  const current: TeachingLoadRow[] = (input.currentAssignments ?? [])
    .filter((a) => a.courseName || a.subjectName)
    .map((a) => ({
      academicYear: a.assignmentAcademicYear,
      courseName: a.courseName,
      year: a.year,
      section: a.sectionName,
      semester: a.assignmentSemester,
      subject: a.subjectCode ? `${a.subjectName ?? ""} (${a.subjectCode})`.trim() : a.subjectName,
      hoursPerWeek: a.hoursPerWeek,
      passPercentage: a.isPast ? a.passPercentage : undefined,
    }));

  const staticCourses: TeachingLoadRow[] = (input.staticCourses ?? [])
    .filter((c) => c.name || c.code)
    .map((c) => ({
      courseName: c.code ? `${c.name ?? ""} (${c.code})`.trim() : c.name,
      hoursPerWeek: c.weeklyCreditHours,
    }));

  const present: TeachingLoadRow[] = (input.tenurePresentRecords ?? [])
    .filter((r) => r.academicYear || r.subject)
    .map((r) => ({
      academicYear: r.academicYear,
      semester: r.semester,
      subject: r.subject,
    }));

  const past: TeachingLoadRow[] = (input.tenurePastRecords ?? [])
    .filter((r) => r.academicYear || r.subject)
    .map((r) => ({
      academicYear: r.academicYear,
      semester: r.semester,
      subject: r.subject,
      passPercentage: r.studentPassPercentage,
    }));

  return [...current, ...staticCourses, ...present, ...past];
}
