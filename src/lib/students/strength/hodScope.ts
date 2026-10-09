import { resolveCatalogId } from "@/lib/college/academicStructure";
import { resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import type { HodDepartmentScope } from "@/lib/departments/scope";
import type { Course } from "@/types";
import { resolveBranchName } from "./aggregate";
import { cleanLabel } from "./config";
import type { StrengthRow } from "./types";

/**
 * Which students an HOD's strength report may count. This is the Students
 * roster's own visibility rule (college/students GET, HOD branch) applied to
 * the strength scan, so an HOD's numbers are exactly the students they can
 * already open in their roster - never more:
 *
 *  - primary:   filed under a department they head, unless a manager owns
 *               that (branch, year) instead (resolveBranchYearOwner);
 *  - child /
 *    managed:   filed under a sub-department or a branch grouped under them
 *               (a managed branch only for the years the manager teaches);
 *  - secondary: pre-registered to one of their branches while still filed
 *               under a shared first-year department - and only for a year
 *               that branch actually teaches. A branch whose first year is
 *               taught by someone else does not count that year's students as
 *               its own strength; they belong to the department teaching them
 *               (the same rule resolveBranchName buckets by, so a student is
 *               never admitted under one branch and then counted under
 *               another).
 *
 * An HOD with no department on file sees nothing, never the whole college.
 * A student passes if ANY rule admits them, so nobody is counted twice: the
 * caller still buckets each student under a single branch.
 */
export function filterRowsForHod(
  rows: StrengthRow[],
  scope: HodDepartmentScope,
  departments: (DepartmentYearRow & { id: string })[],
  courses: Course[]
): StrengthRow[] {
  const own = new Set(scope.ownDepartmentNames);
  const child = new Set(scope.childDepartmentNames);
  const managed = new Set(scope.managedDepartmentNames);
  const deptIdByName = new Map<string, string>();
  for (const d of departments) if (d.name) deptIdByName.set(d.name, d.id);

  const catalogCache = new Map<string, string | undefined>();
  const catalogIdFor = (dept: string, course: string | undefined) => {
    const k = `${dept}\u0001${course ?? ""}`;
    if (!catalogCache.has(k)) catalogCache.set(k, resolveCatalogId(courses, deptIdByName.get(dept), course));
    return catalogCache.get(k);
  };

  return rows.filter((row) => {
    const dept = cleanLabel(row.department);
    const secondary = cleanLabel(row.secondaryDepartment);
    const year = Number(row.year) || 0;

    if (own.has(dept)) {
      const owner = departments.length > 0 ? resolveBranchYearOwner(departments, dept, year, catalogIdFor(dept, row.course)) : dept;
      if (own.has(owner)) return true;
    }
    if (child.has(dept) || managed.has(dept)) {
      if (managed.has(dept) && departments.length > 0) {
        const owner = resolveBranchYearOwner(departments, dept, year, catalogIdFor(dept, row.course));
        if (own.has(owner) || child.has(owner)) return true;
      } else {
        return true;
      }
    }
    if (secondary && (own.has(secondary) || child.has(secondary))) {
      return resolveBranchName(row, departments as never, () => catalogIdFor(dept, row.course)) === secondary;
    }
    return false;
  });
}
