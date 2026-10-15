import { departmentRunsOwnSections } from "@/lib/college/academicStructure";
import type { Course, CourseYearTiming, Department } from "@/types";

type Dept = Department & { id: string };

/**
 * Null when `course` is the Course doc `department` actually runs for its
 * catalog entry, otherwise the reason it isn't: the department's own Course
 * doc when it has one, else the one it inherits (its parent's, for a
 * sub-department) or is fed from (a department listing it in
 * secondaryDepartments) - the same set /api/college/courses?departmentId=
 * offers the page's picker, so Teaching Assignments later resolves the
 * same courseId. Also rejects a "no own sections" parent, which can never
 * hold a section to teach these subjects in.
 */
export function courseOwnershipError(
  course: Pick<Course, "name" | "departmentId"> & { id: string },
  department: Dept,
  allDepartments: Dept[],
  sameCatalogCourses: (Pick<Course, "departmentId" | "isActive"> & { id: string })[]
): string | null {
  const ownDocs = sameCatalogCourses.filter((c) => c.departmentId === department.id && c.isActive !== false);
  const related = new Set<string>([department.id]);
  if (department.parentDepartmentId) related.add(department.parentDepartmentId);
  else for (const d of allDepartments) if ((d.secondaryDepartments ?? []).includes(department.name)) related.add(d.id);
  const belongs = ownDocs.length > 0 ? ownDocs.some((c) => c.id === course.id) : related.has(course.departmentId);
  if (!belongs) {
    return ownDocs.length > 0
      ? `${department.name} has its own copy of ${course.name}. Select it again so subjects attach to that copy.`
      : `${course.name} isn't run by ${department.name}.`;
  }
  if (!departmentRunsOwnSections(department)) {
    return `${department.name} doesn't run sections of its own. Assign into one of its sub-departments instead.`;
  }
  return null;
}

/** The semester numbers a Course-Year Timings doc configures, sorted. */
export function semestersFrom(timing: Partial<CourseYearTiming> | undefined): number[] {
  return (timing?.semesters ?? []).map((s) => Number(s.semester)).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}
