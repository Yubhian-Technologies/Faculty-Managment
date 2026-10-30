// Plans the writes for the "Connect to Neighbour Department" dropdown
// (PATCH /api/college/departments/[id]/neighbour) - the parent/ghost-side
// counterpart of today's only entry point (a neighbour tick-boxing its
// managedDepartments/secondaryDepartments on ITS OWN edit screen). Only ever
// offered on a PARENT or GHOST department's own screen (never a CHILD's -
// see deriveDepartmentRole's own doc-comment for why a child is never
// reachable via managedDepartments on its own).
//
// Writes EXACTLY what the real Case 1/2/4 production data already does by
// convention (verified against VWU/VIT), rather than inventing a new rule:
//   - managedDepartments on the neighbour gets ONLY the connected
//     department's own name - never a child's, even for a GHOST (whose
//     children are reached through it via findManagerViaNoOwnSectionsParent,
//     managedBranches.ts).
//   - secondaryDepartments gets the connected department's own name PLUS
//     every one of its true children's names - UNLESS the department is
//     itself a GHOST (never holds a section, so its own name would be a
//     dead entry), in which case only the children's names go in.
// This produces the identical shape today's manual tick-box flow does for
// every one of the 4 real cases audited - see neighbourConnection.test.ts.
//
// Deliberately does NOT touch any authorization path - it only computes the
// SAME managedDepartments/secondaryDepartments arrays the existing PATCH
// route already accepts and validates (findBranchClaimConflicts etc. still
// run in the route, same as a manual edit would).
import { deriveRoleOnly, type RoleInput } from "./departmentRole";
import { findBranchManager } from "./managedBranches";

export type ConnectionInput = { id: string } & RoleInput;

export interface NeighbourConnectionWrite {
  departmentId: string;
  managedDepartments: string[];
  secondaryDepartments: string[];
}

export interface NeighbourConnectionPlan {
  /** The OLD neighbour, with this department's contribution removed - omitted if it wasn't connected to anyone. */
  disconnectFrom?: NeighbourConnectionWrite;
  /** The NEW neighbour, with this department's contribution added - omitted when only disconnecting. */
  connectTo?: NeighbourConnectionWrite;
}

function trueChildrenOf(dept: ConnectionInput, all: ConnectionInput[]): ConnectionInput[] {
  return all.filter((d) => d.parentDepartmentId === dept.id);
}

function namesToAdd(dept: ConnectionInput, all: ConnectionInput[]): { managed: string[]; secondary: string[] } {
  const role = deriveRoleOnly(dept, all);
  const children = trueChildrenOf(dept, all).map((c) => c.name);
  return {
    managed: [dept.name],
    secondary: role === "GHOST" ? children : [dept.name, ...children],
  };
}

/**
 * `neighbourId === null` disconnects only. Otherwise connects `dept` to the
 * department with that id (moving it off its current neighbour, if any, in
 * the same plan - no separate "disconnect first" step required).
 */
export function planNeighbourConnection(
  dept: ConnectionInput,
  allDepartments: ConnectionInput[],
  neighbourId: string | null
): { error: string } | NeighbourConnectionPlan {
  const role = deriveRoleOnly(dept, allDepartments);
  if (role !== "PARENT" && role !== "GHOST") {
    return { error: "Only a parent or ghost department can be connected to a neighbour" };
  }

  const current = findBranchManager(allDepartments, dept.name);
  const { managed: addedManaged, secondary: addedSecondary } = namesToAdd(dept, allDepartments);
  const plan: NeighbourConnectionPlan = {};

  if (current && current.department.id !== neighbourId) {
    const old = current.department;
    plan.disconnectFrom = {
      departmentId: old.id,
      managedDepartments: (old.managedDepartments ?? []).filter((n) => !addedManaged.includes(n)),
      secondaryDepartments: (old.secondaryDepartments ?? []).filter((n) => !addedSecondary.includes(n)),
    };
  }

  if (neighbourId === null) return plan;

  if (current?.department.id === neighbourId) {
    return { error: "Already connected to this neighbour" };
  }

  const target = allDepartments.find((d) => d.id === neighbourId);
  if (!target) return { error: "Neighbour department not found" };
  const targetRole = deriveRoleOnly(target, allDepartments);
  if (targetRole !== "NEIGHBOUR" && targetRole !== "NEIGHBOUR_SUB") {
    return { error: `"${target.name}" is not a neighbour department` };
  }

  plan.connectTo = {
    departmentId: target.id,
    managedDepartments: Array.from(new Set([...(target.managedDepartments ?? []), ...addedManaged])),
    secondaryDepartments: Array.from(new Set([...(target.secondaryDepartments ?? []), ...addedSecondary])),
  };
  return plan;
}
