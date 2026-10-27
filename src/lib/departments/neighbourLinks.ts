// Explicit, stored mirror of "which neighbour teaches this department's fed
// years" - a denormalized reverse of Department.managedDepartments, kept so a
// parent/child department's OWN record can show "Taught by: X" directly,
// instead of reverse-scanning every other department for a name match (today's
// only way to discover this). Advisory/display-and-navigation ONLY - never
// read by any authorization path. scope.ts/managedBranches.ts/taughtYears.ts
// keep resolving teaching-assignment/timetable authority by calling
// findBranchManager() directly, exactly as before this file existed; if this
// field ever goes stale (a missed write-path sync), the worst case is a UI
// panel showing one neighbour fewer/more than reality, never a wrong access
// decision - see Department.neighbourLinks's own doc-comment, src/types/core.ts.
//
// Deliberately built ON TOP OF findBranchManager (managedBranches.ts) rather
// than re-scanning managedDepartments/secondaryDepartments independently: that
// function is the SAME one scope.ts's canHodEditDepartmentYear uses to decide
// real teaching-assignment authority, including its ghost-parent fallback
// (Case 2 - a branch whose true parent is a GHOST, reached via the parent's
// name in a manager's managedDepartments). Reusing it means this display
// mirror can never show a "neighbour" that doesn't actually have teaching
// authority, or miss one that does.
//
// Typed as an array for forward compatibility, but under today's enforced
// one-owner-per-branch rule (findBranchClaimConflicts, college/departments
// route) a department has AT MOST ONE manager at a time, so this holds 0 or 1
// entries in practice - never "many neighbours feeding the same department".
import { findBranchManager, type DepartmentYearRow } from "@/lib/departments/managedBranches";

export interface NeighbourLink {
  neighbourDepartmentId: string;
  neighbourDepartmentName: string;
  years: number[];
}

export type NeighbourLinkInput = { id: string; name: string } & DepartmentYearRow;

export function resolveNeighbourLinks<T extends NeighbourLinkInput>(
  dept: T,
  allDepartments: T[],
  catalogId?: string
): NeighbourLink[] {
  const manager = findBranchManager(allDepartments, dept.name, catalogId);
  if (!manager || manager.years.length === 0) return [];
  return [{ neighbourDepartmentId: manager.department.id, neighbourDepartmentName: manager.department.name ?? "", years: manager.years }];
}

/**
 * Recomputes neighbourLinks for every department of `collegeId` and writes
 * only the ones that changed - called after a department edit that could
 * have changed who manages whom (managedDepartments, secondaryDepartments,
 * a rename, a Years Taught edit, or promoting a sub-department to top-level -
 * see the PATCH route's own call site). Runs AFTER the real department write
 * has already committed, same non-fatal "best-effort, log on failure" pattern
 * this route already uses for cascadeDepartmentRename/renameDepartmentSeat -
 * never blocks or retries the actual save. A full-college recompute (rather
 * than diffing just the edited department) is deliberate: department counts
 * per college are small (every audited college has under 20), and a manager
 * change can affect departments other than the one being edited (every
 * branch it manages, or used to), so recomputing the whole collection is both
 * simpler and more certainly correct than trying to work out which subset
 * changed.
 */
export async function syncNeighbourLinksForCollege(db: FirebaseFirestore.Firestore, collegeId: string): Promise<void> {
  const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
  const snap = await deptsColl.get();
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as NeighbourLinkInput[];
  const sameLinks = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  const batch = db.batch();
  let n = 0;
  for (const doc of snap.docs) {
    const dept = all.find((d) => d.id === doc.id);
    if (!dept) continue;
    const links = resolveNeighbourLinks(dept, all);
    if (sameLinks((dept as { neighbourLinks?: unknown }).neighbourLinks, links)) continue;
    batch.update(doc.ref, { neighbourLinks: links });
    n++;
  }
  if (n > 0) await batch.commit();
}
