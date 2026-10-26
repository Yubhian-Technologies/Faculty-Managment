// Pure core of scripts/audit-neighbour-links.mjs and scripts/backfill-neighbour-links.mjs
// (no Firebase import, so it is unit-tested in src/lib/departments/neighbourLinks.test.ts,
// which also pins these results to the ones src/lib/departments/neighbourLinks.ts computes -
// they MUST stay identical). Mirrors findBranchManager (src/lib/departments/managedBranches.ts)
// and resolveNeighbourLinks because a plain-JS maintenance script can't import a TS module from
// this repo's build - see departmentRoleCore.mjs for the identical precedent.

function resolveDepartmentCourseScope(d, catalogId) {
  const override = catalogId ? d.courseScopes?.[catalogId] : undefined;
  return {
    assignedYears: override?.assignedYears ?? d.assignedYears ?? [],
  };
}

function noOwnSectionsParentNameOf(departments, branchName) {
  const branch = departments.find((d) => d.name === branchName);
  if (!branch?.parentDepartmentId) return undefined;
  const parent = departments.find((d) => d.id === branch.parentDepartmentId);
  if (!parent?.name || !parent.hasSubDepartments || parent.parentRunsOwnSections !== false) return undefined;
  return parent.name;
}

function findManagerViaNoOwnSectionsParent(departments, branchName) {
  const parentName = noOwnSectionsParentNameOf(departments, branchName);
  if (!parentName) return undefined;
  return departments.find((d) => (d.managedDepartments ?? []).includes(parentName));
}

function managerTeachingYears(departments, manager, catalogId) {
  const own = resolveDepartmentCourseScope(manager, catalogId).assignedYears;
  if (own.length > 0) return own;
  if (manager.parentDepartmentId) {
    const parent = departments.find((p) => p.id === manager.parentDepartmentId);
    return parent ? resolveDepartmentCourseScope(parent, catalogId).assignedYears : [];
  }
  return [];
}

export function findBranchManager(departments, branchName, catalogId) {
  const manager = departments.find((d) => (d.managedDepartments ?? []).includes(branchName)) ?? findManagerViaNoOwnSectionsParent(departments, branchName);
  if (!manager) return null;
  return { department: manager, years: managerTeachingYears(departments, manager, catalogId) };
}

export function resolveNeighbourLinks(dept, allDepartments, catalogId) {
  const manager = findBranchManager(allDepartments, dept.name, catalogId);
  if (!manager || manager.years.length === 0) return [];
  return [{ neighbourDepartmentId: manager.department.id, neighbourDepartmentName: manager.department.name ?? "", years: manager.years }];
}
