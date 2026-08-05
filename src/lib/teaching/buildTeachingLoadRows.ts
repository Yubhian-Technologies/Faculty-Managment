// Unifies every source of "who teaches what" into two grouped table shapes —
// current (the live current teaching assignments + the Module 2 static course
// summary) and past (structured past teaching assignments, which carry a
// pass % current rows never have). Used by both the resume
// (src/lib/pdf/resumeTemplate.ts) and the Edit Faculty Details page
// (TeachingLoadTable) so the two always agree, and both keep current/past
// visually separated rather than intermixed.

export interface TeachingLoadRow {
  academicYear?: string;
  courseName?: string; // the degree/program, e.g. "B.Tech" — NOT the branch
  department?: string; // the branch, e.g. "CSE" — the faculty member's own department
  year?: number; // which year/class within the course, e.g. 1..4
  section?: string;
  semester?: string | number;
  subject?: string;
  hoursPerWeek?: number;
  passPercentage?: number;
  studentFeedback?: number;
}

export interface TeachingLoadGroups {
  current: TeachingLoadRow[];
  past: TeachingLoadRow[];
}

// Combines Year / Branch / Semester / Section into one column instead of four,
// for both the resume PDF and the Edit Faculty Details preview table. Branch
// is the faculty member's department (e.g. "CSE"), not `courseName` — the
// latter is the degree/program (e.g. "B.Tech"), which is the same for every
// row and isn't a "branch". Falls back to courseName only for the Module 2
// static course rows, which never carry a department and would otherwise show
// nothing identifying in this column.
export function formatClassColumn(row: TeachingLoadRow): string {
  const parts = [
    row.year != null ? `Year ${row.year}` : undefined,
    row.department ?? row.courseName,
    row.semester != null && row.semester !== "" ? String(row.semester) : undefined,
    row.section || undefined,
  ].filter((p): p is string => !!p);
  return parts.join(" / ");
}

interface CurrentAssignmentLike {
  courseName?: string;
  year?: number;
  sectionName?: string;
  subjectName?: string;
  subjectCode?: string;
  hoursPerWeek?: number;
  // Every assignment (current or past) carries which academic year/semester it
  // belongs to. `isPast` additionally marks a structured past teaching
  // assignment (added via "Add Past Teaching Assignment" in the Current
  // Teaching Assignments editor) — the only thing that unlocks `passPercentage`.
  assignmentAcademicYear?: string;
  assignmentSemester?: string;
  isPast?: boolean;
  passPercentage?: number;
  studentFeedback?: number;
}

interface StaticCourseLike {
  code?: string;
  name?: string;
  weeklyCreditHours?: number;
}

function toRow(a: CurrentAssignmentLike, department?: string): TeachingLoadRow {
  return {
    academicYear: a.assignmentAcademicYear,
    courseName: a.courseName,
    department,
    year: a.year,
    section: a.sectionName,
    semester: a.assignmentSemester,
    subject: a.subjectCode ? `${a.subjectName ?? ""} (${a.subjectCode})`.trim() : a.subjectName,
    hoursPerWeek: a.hoursPerWeek,
    passPercentage: a.isPast ? a.passPercentage : undefined,
    studentFeedback: a.isPast ? a.studentFeedback : undefined,
  };
}

export function buildTeachingLoadRows(input: {
  currentAssignments?: CurrentAssignmentLike[];
  staticCourses?: StaticCourseLike[];
  // The faculty member's own department (the "branch") — the same for every
  // row, since a person's teaching assignments are all within their own
  // department; not derived per-assignment (assignments don't track it).
  department?: string;
}): TeachingLoadGroups {
  const assignments = (input.currentAssignments ?? []).filter((a) => a.courseName || a.subjectName);
  const currentAssignmentRows = assignments.filter((a) => !a.isPast).map((a) => toRow(a, input.department));
  const pastAssignmentRows = assignments.filter((a) => a.isPast).map((a) => toRow(a, input.department));

  const staticCourses: TeachingLoadRow[] = (input.staticCourses ?? [])
    .filter((c) => c.name || c.code)
    .map((c) => ({
      courseName: c.code ? `${c.name ?? ""} (${c.code})`.trim() : c.name,
      hoursPerWeek: c.weeklyCreditHours,
    }));

  return {
    current: [...currentAssignmentRows, ...staticCourses],
    past: pastAssignmentRows,
  };
}
