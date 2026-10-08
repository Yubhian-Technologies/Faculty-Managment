import type { Course, Department } from "@/types";
import { findBranchManager } from "@/lib/departments/managedBranches";
import { childrenOfDepartment, groupDepartmentsByParent, type DepartmentFilterOption } from "@/lib/departments/departmentTree";
import { resolveTaughtYears } from "@/lib/college/taughtYears";

/**
 * The Course -> Department -> Year choices of the college-wide Timetable view,
 * from the department configuration alone.
 *
 * A Course doc belongs to ONE department; a sub-department shares its parent's
 * programme and never owns one. The page used to offer only departments that own
 * a Course doc of the chosen course, as a flat list - so a sub-department
 * (Basic Science - Maths) or a branch of a split-up core (CSE [AI&ML]) could not
 * be picked, and a parent that only organises its sub-departments had no years of
 * its own. Everything here is ADDED to that: every department the old list had is
 * still there, resolves the same Course doc and offers the same years.
 *
 * Which sections a pick reaches is decided server-side (`/api/college/sections?
 * departmentId=`): a parent reaches its sub-departments and the branches they
 * manage, a sub-department the branches it manages, a branch its own.
 */

/** Every department that offers `courseName`, each sub-department listed under its parent. */
export function timetableDepartmentOptions(
  departments: Department[],
  courses: Course[],
  courseName: string
): (DepartmentFilterOption<Department> & { coversSubDepartments: boolean })[] {
  if (!courseName) return [];
  const ownerIds = new Set(courses.filter((c) => c.name === courseName).map((c) => c.departmentId));
  const offering = new Map<string, Department>();
  for (const d of departments) {
    // Owns a Course doc of this programme, or - a sub-department - shares its parent's.
    if (ownerIds.has(d.id) || (d.parentDepartmentId != null && ownerIds.has(d.parentDepartmentId))) offering.set(d.id, d);
  }
  // A parent whose sub-departments offer it is itself a choice (it stands for all of them).
  for (const d of Array.from(offering.values())) {
    const parent = d.parentDepartmentId ? departments.find((p) => p.id === d.parentDepartmentId) : undefined;
    if (parent) offering.set(parent.id, parent);
  }
  const list = Array.from(offering.values());
  return groupDepartmentsByParent(list, [], { includeInactive: true }).map((o) => ({
    ...o,
    coversSubDepartments: childrenOfDepartment(list, o.department).length > 0,
  }));
}

/**
 * The Course doc a department pick resolves to: its own; else - a sub-department
 * - its parent's; else, for a parent that owns none itself, one of its
 * sub-departments' (the programme is the same).
 */
export function courseForDepartmentPick(
  courses: Course[],
  departments: Department[],
  courseName: string,
  departmentId: string
): Course | null {
  const forDept = (id: string | undefined) => (id ? courses.find((c) => c.name === courseName && c.departmentId === id) ?? null : null);
  const dept = departments.find((d) => d.id === departmentId);
  if (!dept) return null;
  const own = forDept(dept.id);
  if (own) return own;
  const parent = forDept(dept.parentDepartmentId);
  if (parent) return parent;
  for (const child of childrenOfDepartment(departments, dept)) {
    const viaChild = forDept(child.id);
    if (viaChild) return viaChild;
  }
  return null;
}

/**
 * The years a department pick offers for `course`. Its own taught years (or, for a
 * sub-department with none, its parent's) as always; ADDED:
 *  - a parent with none of its own offers the years its sub-departments teach;
 *  - a branch also offers the year(s) its shared-year manager teaches for it, so
 *    its first-year timetable (run by Basic Science - Maths) can be viewed from the
 *    branch as well as from the manager. Empty still means "not configured" - never
 *    every year of the course.
 */
export function yearsForDepartmentPick(
  departments: Department[],
  course: Pick<Course, "durationYears" | "catalogId">,
  departmentId: string
): number[] {
  const dept = departments.find((d) => d.id === departmentId);
  if (!dept) return [];
  const years = new Set<number>(resolveTaughtYears(dept, departments, course.catalogId).years);
  if (years.size === 0) {
    for (const child of childrenOfDepartment(departments, dept)) {
      for (const y of resolveTaughtYears(child, departments, course.catalogId).years) years.add(y);
    }
  }
  const manager = findBranchManager(departments, dept.name, course.catalogId ?? undefined);
  if (manager) for (const y of manager.years) years.add(y);
  const courseYears = Array.from({ length: Number(course.durationYears) || 0 }, (_, i) => i + 1);
  return courseYears.filter((y) => years.has(y));
}
