import { resolveCourseByNameOrCode } from "@/lib/departments/codeOrNameResolver";
import { resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";

// Which course a student can be moved to by an edit, and the Course document that choice stands for.
//
// A student's `course` is a free-text label and `courseId` is the real reference every join (section, timetable,
// attendance, year ownership) goes through. The Edit form used to change only the label, so a student could read
// "Master of Technology" while every other module still saw the old course. Both are resolved here, with the SAME
// rules the bulk importer applies (students/import-excel: resolveCourse + resolveCourseId), so a student added,
// imported or edited ends up with the same pair:
//   - the course must be one the student's department offers; a sub-department offers its parent's (it owns none);
//   - the Course document is the one that owns the year - for a shared first year that is the department that
//     manages the branch (resolveBranchYearOwner), not the branch's own document.

export interface CourseRow {
  id: string;
  name?: string;
  code?: string;
  departmentId?: string;
  catalogId?: string;
}

export type DepartmentRow = DepartmentYearRow & { id: string; name?: string };

export type StudentCourseResolution =
  | { ok: true; name: string; courseId: string }
  | { ok: false; reason: string };

export function resolveStudentCourse(args: {
  departments: DepartmentRow[];
  courses: CourseRow[];
  departmentName: string;
  year: number;
  input: string;
}): StudentCourseResolution {
  const { departments, courses, departmentName, year, input } = args;
  const dept = departments.find((d) => (d.name ?? "").trim().toLowerCase() === departmentName.trim().toLowerCase());
  if (!dept) return { ok: false, reason: `Department "${departmentName}" was not found` };

  const effectiveId = (id: string) => departments.find((d) => d.id === id)?.parentDepartmentId ?? id;
  const offered = Array.from(new Set(courses.filter((c) => c.departmentId === effectiveId(dept.id)).map((c) => (c.name ?? "").trim()).filter(Boolean)));

  const canonical = resolveCourseByNameOrCode(courses, effectiveId(dept.id), input);
  if (!canonical) {
    return {
      ok: false,
      reason: `"${input.trim()}" is not a course ${departmentName} offers${offered.length ? ` (it offers: ${offered.join(", ")})` : ""}`,
    };
  }

  // The Course document that owns this department's year (a shared first year belongs to the department that
  // manages the branch), falling back to the department's own document for the course.
  const catalogId = courses.find((c) => (c.name ?? "").trim() === canonical)?.catalogId;
  const ownerName = resolveBranchYearOwner(departments, dept.name ?? departmentName, year, catalogId);
  const owner = departments.find((d) => d.name === ownerName) ?? dept;
  const courseId =
    courses.find((c) => c.departmentId === effectiveId(owner.id) && (c.name ?? "").trim() === canonical)?.id
    ?? courses.find((c) => c.departmentId === effectiveId(dept.id) && (c.name ?? "").trim() === canonical)?.id;
  if (!courseId) return { ok: false, reason: `No "${canonical}" course record was found for ${departmentName}` };
  return { ok: true, name: canonical, courseId };
}
