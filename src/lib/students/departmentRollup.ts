import { childrenOfDepartment, rollupDepartmentNames, type TreeDepartment } from "@/lib/departments/departmentTree";

/**
 * The department names a student list's Department filter must match for the
 * picked name (see rollupDepartmentNames in departmentTree.ts for the rule).
 *
 * The browser decides "this parent holds nothing" from the section list it
 * already has; the server has no such list, so it asks the one question it
 * needs - is any section filed under the picked parent's own name? - and only
 * for a department that could possibly be a container (has sub-departments,
 * and the Principal has not already said so with `parentRunsOwnSections:
 * false`). Every other pick costs nothing extra.
 *
 * A failed lookup falls back to "unknown", where only the explicit flag counts,
 * so a read error can never widen or narrow a filter by guesswork.
 */
export async function resolveRollupDepartmentNames<T extends TreeDepartment>(
  collegeRef: FirebaseFirestore.DocumentReference,
  all: T[],
  pickedName: string
): Promise<string[]> {
  const name = (pickedName ?? "").trim();
  if (!name) return [];
  const dept = all.find((d) => (d.name ?? "").trim() === name);
  const couldBeContainer = !!dept?.hasSubDepartments && dept.parentRunsOwnSections !== false && childrenOfDepartment(all, dept).length > 0;
  if (!couldBeContainer) return rollupDepartmentNames(all, name);
  try {
    const snap = await collegeRef.collection("sections").where("department", "==", name).limit(1).get();
    return rollupDepartmentNames(all, name, !snap.empty);
  } catch {
    return rollupDepartmentNames(all, name);
  }
}
