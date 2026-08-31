import { findBranchManager, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { managerEffectiveYears } from "@/lib/departments/hodScope";
import type { Course, Department } from "@/types";

// Where a course-year's period timings actually live when the year is a shared
// first year run by someone else.
//
// Every department owns its own Course doc for the same catalog programme, and
// CourseYearTiming is keyed by (courseId, year). A section created through the
// managed-branch route is owned BY the branch (e.g. "BSC-CSE-A" under Computer
// Science Engineering, routed there because BS Chemistry manages CSE) and so
// stores the BRANCH's course id - while the Principal configures the shared
// first year once, on the common department that actually runs it (Basic
// Science). The exact-id lookup then finds nothing and the timetable reports
// "No period timing is configured for this course year", even though the year
// is configured exactly where it belongs.
//
// This resolves that one case and no other: the fallback applies only when a
// manager genuinely owns (department, year) - the same ownership rule
// resolveBranchYearOwner applies to sections - so a department that is simply
// missing its own year-3 timings never silently borrows another department's.

/**
 * The course doc whose timings govern `year` for `course`, when that year is
 * run by a shared-year manager rather than by the course's own department.
 * Returns null when the year is the department's own - the caller should then
 * use its own (courseId, year) row, or report it as unconfigured.
 */
export function inheritedTimingCourseId(
  course: Pick<Course, "id" | "departmentId" | "catalogId">,
  year: number,
  departments: (Department & { id: string })[],
  courses: Pick<Course, "id" | "departmentId" | "catalogId">[]
): string | null {
  const ownDept = departments.find((d) => d.id === course.departmentId);
  if (!ownDept) return null;

  const manager = findBranchManager(departments as unknown as DepartmentYearRow[], ownDept.name);
  if (!manager) return null;
  const managerDept = departments.find((d) => d.id === manager.department.id);
  if (!managerDept || managerDept.id === ownDept.id) return null;

  // Only the years the manager itself teaches - every other year belongs to
  // this department's own HOD and must not fall through.
  if (!managerEffectiveYears(managerDept, departments, course.catalogId).includes(Number(year))) {
    return null;
  }

  // A sub-department (BS Chemistry) owns no Course doc of its own - it shares
  // its parent's - so try the manager first, then the parent it sits under.
  for (const deptId of [managerDept.id, managerDept.parentDepartmentId]) {
    if (!deptId) continue;
    const match = courses.find(
      (c) => c.departmentId === deptId && c.catalogId && c.catalogId === course.catalogId
    );
    if (match) return match.id;
  }
  return null;
}
