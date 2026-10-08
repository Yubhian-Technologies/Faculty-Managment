import type { Department } from "@/types";
import { sectionMatchesDepartmentFilter } from "@/lib/departments/hodScope";
import { managedCoreCandidates } from "@/lib/departments/departmentTree";

/**
 * The branches whose sections a picked department is responsible for in
 * `year` - the ones that are NOT filed under its own name.
 *
 * A section is filed under the real branch for every year, never under the
 * shared-first-year department that runs its first year. So "the sections of
 * Basic Science (or Basic Science - Maths)" cannot be a name match: it is the
 * managed branches' sections for the year(s) that department actually teaches.
 * That is decided by the existing year-aware owner rule
 * (`sectionMatchesDepartmentFilter` -> `resolveBranchYearOwner`), not by
 * anything here, so a manager still gets only its own year(s) and never the
 * branch's later ones, which belong to the branch's own HOD.
 *
 * Reads the configuration only: what the picked department (and its
 * sub-departments) manage, including the sub-branches of a managed branch that
 * holds no sections itself. Empty for any department that manages nothing, so
 * callers that add these names to a query change nothing for such a department.
 */
export function managedSectionDepartments(
  all: Department[],
  pickedName: string,
  year: number,
  catalogId?: string
): string[] {
  const name = (pickedName ?? "").trim();
  if (!name) return [];
  const dept = all.find((d) => (d.name ?? "").trim() === name);
  if (!dept) return [];
  return managedCoreCandidates(all, dept).filter(
    (branch) => branch !== name && sectionMatchesDepartmentFilter(all, name, branch, year, catalogId)
  );
}
