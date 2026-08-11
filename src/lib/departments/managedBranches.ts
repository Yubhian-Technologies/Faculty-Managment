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
