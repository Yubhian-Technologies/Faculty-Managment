// A branch (top-level department such as IT or CSBS) may be grouped under at
// most ONE sub-department. Grouping is what grants a Sub-HOD full control of
// that branch's students and sections (Department.managedDepartments, resolved
// by getHodDepartmentScope), so letting two sub-departments claim the same
// branch would hand two different Sub-HODs write access to the same roster with
// no way to say which one owns it - and would make "distribute this branch's
// students" ambiguous. The rule is enforced on write, here.
//
// Shared by the create and update paths in college/departments/route.ts, which
// each already hold a full read of the departments collection.

export interface DepartmentClaimRow {
  id: string;
  name?: string;
  managedDepartments?: string[];
}

export interface BranchClaimConflict {
  branch: string;
  ownedBy: string;
}

/**
 * Returns the branches in `names` that some OTHER department already manages.
 * `selfId` is the department being created or updated - its own existing
 * claims never conflict with itself, so re-saving an unchanged list is a no-op.
 */
export function findBranchClaimConflicts(
  departments: DepartmentClaimRow[],
  names: string[],
  selfId?: string
): BranchClaimConflict[] {
  const wanted = new Set(names.map((n) => n.trim()).filter(Boolean));
  if (wanted.size === 0) return [];

  const conflicts: BranchClaimConflict[] = [];
  for (const d of departments) {
    if (selfId && d.id === selfId) continue;
    for (const claimed of d.managedDepartments ?? []) {
      const branch = claimed.trim();
      if (branch && wanted.has(branch)) {
        conflicts.push({ branch, ownedBy: d.name ?? "another sub-department" });
      }
    }
  }
  return conflicts;
}

/** The 409 message shown when a branch is already grouped elsewhere. */
export function branchClaimConflictMessage(conflicts: BranchClaimConflict[]): string {
  return conflicts
    .map((c) => `"${c.branch}" is already managed by "${c.ownedBy}". Remove it there first.`)
    .join(" ");
}

export interface DepartmentYearRow extends DepartmentClaimRow {
  assignedYears?: number[];
  parentDepartmentId?: string;
}

export interface BranchManager<T> {
  department: T;
  /** Years the manager actually teaches - its own assignedYears, or, if it has
   * none of its own (the common shape for a sub-department), its parent common
   * department's. */
  years: number[];
}

/**
 * The department that manages `branchName` via `Department.managedDepartments`
 * (e.g. a sub-department like "BS-English" grouping "CIVIL" for the shared
 * first year), and the years it actually teaches. A branch is only reached
 * through its manager for THOSE years - every other year belongs to the
 * branch's own dedicated HOD (Department.assignedYears on the branch itself).
 * Mirrors resolveSubjectDepartment's rule for the older secondaryDepartments
 * mechanism, generalized to managedDepartments. Returns null when nothing
 * manages this branch.
 */
export function findBranchManager<T extends DepartmentYearRow>(
  departments: T[],
  branchName: string
): BranchManager<T> | null {
  const manager = departments.find((d) => (d.managedDepartments ?? []).includes(branchName));
  if (!manager) return null;
  let years = manager.assignedYears ?? [];
  if (years.length === 0 && manager.parentDepartmentId) {
    years = departments.find((p) => p.id === manager.parentDepartmentId)?.assignedYears ?? [];
  }
  return { department: manager, years };
}

/**
 * Whichever department actually owns (branchName, year): the manager, if one
 * manages this branch and teaches this year - otherwise the branch itself.
 * Used to decide access/visibility: a branch's own dedicated HOD should never
 * see a section for a year their manager owns instead, and vice versa.
 */
export function resolveBranchYearOwner<T extends DepartmentYearRow & { name?: string }>(
  departments: T[],
  branchName: string,
  year: number
): string {
  const manager = findBranchManager(departments, branchName);
  return manager && manager.years.includes(year) ? (manager.department.name ?? branchName) : branchName;
}

/**
 * Year-aware counterpart of `canHodEditDepartment` (scope.ts) - true when
 * `departmentName` at `year` is actually this HOD's to read/write. A true
 * sub-department (childDepartmentNames) is owned outright, no year check -
 * only a MANAGED branch (own department, or a grouped branch reached via
 * `managedDepartments`) is year-scoped, since that's the relationship split
 * between a shared-year manager and the branch's own dedicated HOD.
 * Mirrors the inline check `college/sections` GET already applies per
 * section - the students routes (list, distribute, per-student edit) need
 * the exact same rule so a manager can never see or move a branch's
 * non-shared-year students, and the branch's own HOD can never see or move
 * the shared-year ones. `departments` must be the full department list (for
 * `resolveBranchYearOwner` to resolve who manages `departmentName`).
 */
export function canHodEditDepartmentYear<T extends DepartmentYearRow & { name?: string }>(
  scope: { departmentName: string; childDepartmentNames: string[]; managedDepartmentNames: string[] },
  departments: T[],
  departmentName: string,
  year: number
): boolean {
  if (!departmentName || !scope.departmentName) return false;
  if (scope.childDepartmentNames.includes(departmentName)) return true;
  if (departmentName !== scope.departmentName && !scope.managedDepartmentNames.includes(departmentName)) {
    return false;
  }
  const owner = resolveBranchYearOwner(departments, departmentName, year);
  return owner === scope.departmentName || scope.childDepartmentNames.includes(owner);
}
