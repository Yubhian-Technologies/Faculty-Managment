// Pure core of scripts/audit-department-roles.mjs and scripts/backfill-department-roles.mjs
// (no Firebase import, so it is unit-tested in src/lib/departments/departmentRole.test.ts,
// which also pins these results to the ones src/lib/departments/departmentRole.ts computes -
// they MUST stay identical). Mirrors that file because a plain-JS maintenance script can't
// import a TS module from this repo's build - see that file's own doc-comment, and
// scripts/lib/subjectKeysCore.mjs for the identical precedent.

const scopes = (d) => Object.values(d.courseScopes ?? {});

function isFeederShaped(d) {
  if ((d.managedDepartments ?? []).length > 0) return true;
  if ((d.secondaryDepartments ?? []).length > 0) return true;
  return scopes(d).some((s) => (s.secondaryDepartments ?? []).length > 0);
}

function hasOwnYears(d) {
  if ((d.assignedYears ?? []).length > 0) return true;
  return scopes(d).some((s) => (s.assignedYears ?? []).length > 0);
}

export function deriveRoleOnly(dept, allDepartments) {
  if (dept.parentDepartmentId) {
    const siblings = allDepartments.filter((d) => d.id !== dept.id && d.parentDepartmentId === dept.parentDepartmentId);
    if (isFeederShaped(dept) || siblings.some(isFeederShaped)) return "NEIGHBOUR_SUB";
    return "CHILD";
  }
  if (dept.hasSubDepartments) {
    const children = allDepartments.filter((d) => d.parentDepartmentId === dept.id);
    if (children.some(isFeederShaped)) return "NEIGHBOUR";
    if (dept.parentRunsOwnSections === false) return "GHOST";
    return "PARENT";
  }
  return isFeederShaped(dept) ? "NEIGHBOUR" : "PARENT";
}

export function deriveDepartmentRole(dept, allDepartments) {
  const role = deriveRoleOnly(dept, allDepartments);
  const flags = [];

  if (role === "GHOST" && hasOwnYears(dept)) flags.push("GHOST_HAS_OWN_YEARS");
  if (role === "NEIGHBOUR_SUB" && !isFeederShaped(dept)) flags.push("NEIGHBOUR_SUB_UNCONFIGURED");

  if (dept.parentDepartmentId) {
    const parent = allDepartments.find((d) => d.id === dept.parentDepartmentId);
    if (parent?.parentDepartmentId) flags.push("PARENT_DEPARTMENT_CHAIN_DEPTH_GT_1");
  }

  const claimants = allDepartments.filter((d) => d.id !== dept.id && (d.managedDepartments ?? []).includes(dept.name));
  if (claimants.length > 1) flags.push("MULTIPLE_MANAGERS_CLAIM_THIS_BRANCH");

  if (role === "NEIGHBOUR" || role === "NEIGHBOUR_SUB") {
    const secondaryTargets = [...(dept.secondaryDepartments ?? []), ...scopes(dept).flatMap((s) => s.secondaryDepartments ?? [])];
    for (const name of new Set(secondaryTargets)) {
      const target = allDepartments.find((d) => d.name === name);
      if (target && deriveRoleOnly(target, allDepartments) === "GHOST") {
        flags.push(`SECONDARY_DEPARTMENTS_TARGETS_GHOST_DIRECTLY:${name}`);
      }
    }
  }

  return { role, flags };
}
