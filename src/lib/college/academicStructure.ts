// Derives which of the two academic structures a college follows. There is
// deliberately NO stored flag for this - the shape is inferred from the
// departments themselves, so an existing college needs no migration and no
// setup step it can forget.
//
//  1. COMMON FIRST YEAR - one shared department (e.g. "Basic Science") owns
//     year 1 for every branch. It is split into sub-departments (BS-Maths,
//     BS-English, ...), each with a Sub-HOD, and each sub-department is given
//     whole branches (IT, CSBS) to manage via `managedDepartments`. Students
//     keep their real branch throughout - the sub-department is a management
//     view over them, never their department.
//  2. DEPARTMENT DIRECT - no such department; every branch runs its own years
//     end to end. This is the default, and what every college looks like until
//     a common-year department is actually configured.
//
// Because the rule is inferred rather than stored, it must live in exactly one
// place: every caller goes through getAcademicStructure() rather than
// re-checking `assignedYears`/`hasSubDepartments` inline, so the definition
// can't drift between routes. If the heuristic ever needs to change (or become
// a stored flag), this file is the only thing to edit.
import type { Department } from "@/types";

export type DepartmentWithId = Department & { id: string };

export interface AcademicStructure {
  /** True when a common-year department exists - i.e. structure (1) above. */
  isCommonFirstYear: boolean;
  /** The department that owns the shared year(s), or null for a direct college. */
  commonDepartment: DepartmentWithId | null;
  /** The years that department claims - usually [1], but a college is free to share more. */
  commonYears: number[];
  /** The common department's sub-departments (empty for a direct college). */
  subDepartments: DepartmentWithId[];
  /**
   * branch name -> the sub-department that manages it. The index behind the
   * "a branch may be grouped under only ONE sub-department" constraint, and
   * what lets the cohort distribute route report who owns each branch.
   */
  managedBranchOwner: Map<string, string>;
  /** Every department in the college, already read - so callers don't re-fetch. */
  allDepartments: DepartmentWithId[];
}

/**
 * A department qualifies as the shared first-year department when it claims
 * year 1 AND acts as a shared parent - either by being split into
 * sub-departments (`hasSubDepartments`) or by cross-listing the branches it
 * feeds (`secondaryDepartments`). A plain department that merely teaches year 1
 * for its own branch matches neither and is correctly left alone.
 */
function isCommonYearDepartment(d: DepartmentWithId): boolean {
  if (d.isActive === false) return false;
  if (d.parentDepartmentId) return false; // sub-departments never qualify
  if (!(d.assignedYears ?? []).includes(1)) return false;
  return Boolean(d.hasSubDepartments) || (d.secondaryDepartments ?? []).length > 0;
}

/** Builds the branch -> owning sub-department index from a set of departments. */
export function buildManagedBranchOwner(departments: DepartmentWithId[]): Map<string, string> {
  const owner = new Map<string, string>();
  for (const d of departments) {
    for (const branch of d.managedDepartments ?? []) {
      const name = branch.trim();
      // First claim wins. Pre-existing data may already violate the one-owner
      // rule (it was unenforced until now), so this stays deterministic
      // rather than throwing - the constraint is enforced on write instead.
      if (name && !owner.has(name)) owner.set(name, d.name);
    }
  }
  return owner;
}

export async function getAcademicStructure(
  db: FirebaseFirestore.Firestore,
  collegeId: string
): Promise<AcademicStructure> {
  const snap = await db.collection("colleges").doc(collegeId).collection("departments").get();
  const allDepartments = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentWithId[];
  return structureFromDepartments(allDepartments);
}

/**
 * Pure counterpart of getAcademicStructure, for callers that have already read
 * the departments collection (the departments route reads it for its own
 * uniqueness checks) or for the client, which loads it from /api/college/departments.
 */
export function structureFromDepartments(allDepartments: DepartmentWithId[]): AcademicStructure {
  const managedBranchOwner = buildManagedBranchOwner(allDepartments);

  // Deterministic pick if a college somehow has more than one candidate:
  // prefer the one with sub-departments, then the lowest name, so every
  // caller in a request resolves to the same department.
  const candidates = allDepartments.filter(isCommonYearDepartment).sort((a, b) => {
    if (Boolean(b.hasSubDepartments) !== Boolean(a.hasSubDepartments)) {
      return Number(Boolean(b.hasSubDepartments)) - Number(Boolean(a.hasSubDepartments));
    }
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
  const commonDepartment = candidates[0] ?? null;

  return {
    isCommonFirstYear: commonDepartment !== null,
    commonDepartment,
    commonYears: commonDepartment ? [...(commonDepartment.assignedYears ?? [])].sort((a, b) => a - b) : [],
    subDepartments: commonDepartment
      ? allDepartments.filter((d) => d.parentDepartmentId === commonDepartment.id)
      : [],
    managedBranchOwner,
    allDepartments,
  };
}
