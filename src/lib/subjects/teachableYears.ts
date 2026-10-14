import { findBranchManager, managerTeachingYears, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import type { Course, Department } from "@/types";

// Which ordinal years (1..durationYears) `department` actually teaches
// `course` for - same resolution academics/teaching-assignments/page.tsx's
// own yearOptions and (before it was removed) assign-semester/page.tsx's
// yearOptions already use: the department's own (or inherited-from-parent)
// configured years - and NONE when it is genuinely unconfigured. An empty Years Taught is
// "not configured", never "teaches every year" (lib/college/taughtYears.ts).
// Extracted here so Course Structure's pre-import validation (does the
// SELECTED department even teach this row's Year?) shares the exact same
// rule the Year dropdown elsewhere in Academics already enforces, rather
// than a second, possibly-drifting copy of it.
export function teachableYearsForDepartment(
  course: Pick<Course, "durationYears" | "catalogId">,
  department: Department,
  allDepartments: Department[]
): number[] {
  const courseYears = Array.from({ length: course.durationYears }, (_, i) => i + 1);
  const catalogId = course.catalogId;
  const assigned = managerTeachingYears(allDepartments, department, catalogId);
  return courseYears.filter((y) => assigned.includes(y));
}

export interface AssignableYears {
  /** Years the department itself runs for this course (its own Years Taught). */
  own: number[];
  /** Years only reachable through its managing department (not in its own Years Taught). */
  shared: number[];
  /** Every year its managing department maintains for it - the shared first year - whether or not the department also lists it itself. */
  managerYears: number[];
  /** Branches this department manages for this course, per year: assignment to a manager is refused in those years. */
  managedBranchYears: { branch: string; years: number[] }[];
}

/**
 * Where subjects can be assigned for `department`: its own years PLUS the shared years a managing
 * department runs for it. A shared year's subjects belong to the CORE department (CSE), never to the
 * manager (Basic Science) - the manager gets access to them through the managed link. A department that
 * itself manages branches for this course is not a place to assign those years to (managedBranchYears).
 */
export function assignableYearsForDepartment(
  course: Pick<Course, "durationYears" | "catalogId">,
  department: Department,
  allDepartments: Department[]
): AssignableYears {
  const own = teachableYearsForDepartment(course, department, allDepartments);
  const inCourse = (y: number) => Number.isInteger(y) && y >= 1 && y <= course.durationYears;
  const manager = findBranchManager(allDepartments as unknown as DepartmentYearRow[], department.name, course.catalogId);
  const managerYears = manager && manager.department.id !== department.id ? manager.years.filter(inCourse) : [];
  const shared = managerYears.filter((y) => !own.includes(y));
  const managedBranchYears: AssignableYears["managedBranchYears"] = [];
  for (const branch of department.managedDepartments ?? []) {
    const m = findBranchManager(allDepartments as unknown as DepartmentYearRow[], branch, course.catalogId);
    if (m && m.department.id === department.id) {
      const years = m.years.filter(inCourse);
      if (years.length > 0) managedBranchYears.push({ branch, years });
    }
  }
  return { own, shared, managerYears, managedBranchYears };
}
