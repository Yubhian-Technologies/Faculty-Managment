// Advisory-only classification of a department into one of the five roles the
// Principal-facing vocabulary uses - PARENT / CHILD / GHOST / NEIGHBOUR /
// NEIGHBOUR_SUB. This is a NAME for what Department's existing structural
// fields already mean (see Department.departmentRole's own doc-comment,
// src/types/core.ts); it is never a new source of truth. scope.ts,
// academicStructure.ts, managedBranches.ts, taughtYears.ts and every API
// route keep reading hasSubDepartments/parentRunsOwnSections/
// managedDepartments/secondaryDepartments/parentDepartmentId directly, exactly
// as before this file existed. UI callers should call deriveDepartmentRole()
// LIVE rather than trust Department.departmentRole's stored copy, so a stale
// backfill can never display something no longer true.
//
// Mirrored (not imported - this runs from a plain-JS maintenance script
// outside the Next.js/TS build) by scripts/lib/departmentRoleCore.mjs, pinned
// identical to this file by departmentRole.test.ts - same pattern this repo
// already uses for scripts/lib/subjectKeysCore.mjs / src/lib/subjects/subjectKeys.ts.
import type { Department, DepartmentCourseScope } from "@/types";

export type DepartmentRole = "PARENT" | "CHILD" | "GHOST" | "NEIGHBOUR" | "NEIGHBOUR_SUB";

export interface DepartmentRoleResult {
  role: DepartmentRole;
  /** Flagged contradictions/unconfigured states - surfaced for human review, never auto-fixed. */
  flags: string[];
}

export type RoleInput = {
  id: string;
  name: string;
} & Pick<
  Department,
  "parentDepartmentId" | "hasSubDepartments" | "parentRunsOwnSections" | "managedDepartments" | "secondaryDepartments" | "assignedYears" | "courseScopes"
>;

const scopes = (d: RoleInput): DepartmentCourseScope[] => Object.values(d.courseScopes ?? {});

/** Does `d` use managedDepartments/secondaryDepartments to teach for ANOTHER department - i.e. is it feeder-shaped (a neighbour)? */
function isFeederShaped(d: RoleInput): boolean {
  if ((d.managedDepartments ?? []).length > 0) return true;
  if ((d.secondaryDepartments ?? []).length > 0) return true;
  return scopes(d).some((s) => (s.secondaryDepartments ?? []).length > 0);
}

/** Does `d` claim any Years Taught of its own (flat or per-course) - the GHOST contradiction check. */
function hasOwnYears(d: RoleInput): boolean {
  if ((d.assignedYears ?? []).length > 0) return true;
  return scopes(d).some((s) => (s.assignedYears ?? []).length > 0);
}

/**
 * The role from structure alone, with no contradiction flags. Exported so
 * flag-detection below can classify a referenced department (e.g. "is the
 * thing my secondaryDepartments names a GHOST") without duplicating this
 * switch.
 */
export function deriveRoleOnly(dept: RoleInput, allDepartments: RoleInput[]): DepartmentRole {
  if (dept.parentDepartmentId) {
    // A true sub-department. Whether it itself holds real students
    // (CHILD) or is one of a "Basic Science"-shaped container's feeder
    // sub-departments (NEIGHBOUR_SUB) is decided by whether IT, or any of
    // its siblings, is feeder-shaped - a sibling that's unconfigured yet
    // (no managedDepartments set) still belongs to the same family, so it's
    // classified NEIGHBOUR_SUB too (flagged UNCONFIGURED below), never CHILD.
    const siblings = allDepartments.filter((d) => d.id !== dept.id && d.parentDepartmentId === dept.parentDepartmentId);
    if (isFeederShaped(dept) || siblings.some(isFeederShaped)) return "NEIGHBOUR_SUB";
    return "CHILD";
  }
  if (dept.hasSubDepartments) {
    // A container. If any real child is feeder-shaped, this is a
    // "Basic Science"-shaped NEIGHBOUR dept, regardless of its own
    // parentRunsOwnSections value (VIT's "Basic Science" literally carries
    // parentRunsOwnSections:true yet never enrolls a student itself - the
    // field alone can't tell this apart from a genuine PARENT like "CSE",
    // which is exactly why this role needs the children's shape, not just
    // the flag, to classify correctly).
    const children = allDepartments.filter((d) => d.parentDepartmentId === dept.id);
    if (children.some(isFeederShaped)) return "NEIGHBOUR";
    if (dept.parentRunsOwnSections === false) return "GHOST";
    return "PARENT";
  }
  return isFeederShaped(dept) ? "NEIGHBOUR" : "PARENT";
}

/**
 * Classifies `dept` and flags (never fixes) contradictions worth a human's
 * attention: a GHOST that also claims its own years, a branch claimed by more
 * than one department's managedDepartments at once (the one-owner-per-branch
 * rule - buildManagedBranchOwner, academicStructure.ts - is enforced only on
 * write; pre-existing data may already violate it - a GHOST/PARENT named in
 * exactly one manager's list, the designed Case 2/4 shape, is NOT flagged), a
 * parentDepartmentId chain deeper than the one hop
 * every consumer in this codebase actually supports, a NEIGHBOUR/NEIGHBOUR_SUB
 * whose secondaryDepartments names a GHOST directly (secondaryDepartments must
 * always name a real section-holding department - see isDeclaredFeederFor,
 * academicStructure.ts - unlike managedDepartments, which legitimately targets
 * a GHOST's own name by design, see findManagerViaNoOwnSectionsParent,
 * managedBranches.ts), and a NEIGHBOUR_SUB that inherited its role only from a
 * sibling and has nothing of its own connected yet.
 */
export function deriveDepartmentRole(dept: RoleInput, allDepartments: RoleInput[]): DepartmentRoleResult {
  const role = deriveRoleOnly(dept, allDepartments);
  const flags: string[] = [];

  if (role === "GHOST" && hasOwnYears(dept)) flags.push("GHOST_HAS_OWN_YEARS");

  if (role === "NEIGHBOUR_SUB" && !isFeederShaped(dept)) flags.push("NEIGHBOUR_SUB_UNCONFIGURED");

  if (dept.parentDepartmentId) {
    const parent = allDepartments.find((d) => d.id === dept.parentDepartmentId);
    if (parent?.parentDepartmentId) flags.push("PARENT_DEPARTMENT_CHAIN_DEPTH_GT_1");
  }

  // The one-owner-per-branch rule (buildManagedBranchOwner, academicStructure.ts)
  // is enforced only on write (findBranchClaimConflicts) - pre-existing data may
  // already violate it. A GHOST/PARENT being named in exactly ONE manager's
  // managedDepartments is the designed Case 2/4 shape, not a contradiction.
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
