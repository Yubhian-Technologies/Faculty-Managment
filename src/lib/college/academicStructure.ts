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
import type { Department, DepartmentCourseScope } from "@/types";

export type DepartmentWithId = Department & { id: string };

/**
 * A department's academic-structure fields (assignedYears/secondaryDepartments),
 * resolved for one specific course. A department can offer several courses
 * (see Department.courseScopes) that need different structures - e.g. a
 * B.Tech with a common first year through this department, and an M.Tech it
 * runs independently end to end. A course with no entry in `courseScopes`
 * falls back to the department's flat fields, which stay the permanent
 * default. Always call this rather than reading either directly, so the
 * override-or-fallback logic lives in exactly one place.
 *
 * Deliberately does NOT resolve hasSubDepartments or managedDepartments -
 * those describe real, non-course-scoped entities (child Department docs,
 * and who's authorized to edit a branch's roster) and stay flat-only.
 */
export function resolveDepartmentCourseScope(
  department: Pick<Department, "assignedYears" | "secondaryDepartments" | "courseScopes">,
  catalogId: string | undefined | null
): DepartmentCourseScope {
  const override = catalogId ? department.courseScopes?.[catalogId] : undefined;
  return {
    assignedYears: override?.assignedYears ?? department.assignedYears ?? [],
    secondaryDepartments: override?.secondaryDepartments ?? department.secondaryDepartments ?? [],
  };
}

/**
 * Whether a department already acts as a shared-year structural node - split
 * into sub-departments, or already cross-listing branches for some course
 * (its flat fields, or any per-course override). Such a department adding
 * ANOTHER catalog course needs to deliberately decide how that course
 * relates to its branches (see findUnconnectedCourseOwners) rather than
 * silently inheriting whatever cross-listing happens to already be set - that
 * silent inheritance is exactly what let an M.Tech course added to a
 * B.Tech-shared-first-year department come out cross-listed to the same
 * branches by accident. An ordinary branch department (no sub-departments,
 * never cross-lists anyone) has no such expectation, so adding its own
 * independent copy of any course - the completely normal "every branch runs
 * its own program" shape - is never restricted by this.
 */
export function isSharedYearStructuralDepartment(
  department: Pick<Department, "hasSubDepartments" | "secondaryDepartments" | "courseScopes">
): boolean {
  if (department.hasSubDepartments) return true;
  if ((department.secondaryDepartments ?? []).length > 0) return true;
  return Object.values(department.courseScopes ?? {}).some((s) => (s.secondaryDepartments ?? []).length > 0);
}

/**
 * Other departments that already offer `catalogId` with no declared
 * relationship to `department` for it - neither cross-lists the other. Used
 * to flag (client) or block (server, for a shared-year structural
 * department - see isSharedYearStructuralDepartment) an accidental second,
 * unrelated program under the same catalog entry, e.g. Basic Science's own
 * M.Tech ending up cross-listed to the same branches as its B.Tech by
 * accident, or nothing at all when it should be independent.
 *
 * `intendedSecondaryDepartments` is what `department` is ABOUT to have for
 * this course - pass the value being submitted in the same request (course
 * creation happens before any override is written, so the resolved value
 * would otherwise still be the old one); omitted, falls back to whatever's
 * already resolved (editing an existing course's structure).
 */
export function findUnconnectedCourseOwners(
  department: Pick<Department, "id" | "name" | "secondaryDepartments" | "courseScopes">,
  catalogId: string,
  otherDepartmentIdsOfferingCourse: string[],
  allDepartments: DepartmentWithId[],
  intendedSecondaryDepartments?: string[]
): DepartmentWithId[] {
  const ourSecondary = intendedSecondaryDepartments ?? resolveDepartmentCourseScope(department, catalogId).secondaryDepartments;
  const seen = new Set<string>();
  const conflicts: DepartmentWithId[] = [];
  for (const otherId of otherDepartmentIdsOfferingCourse) {
    if (otherId === department.id || seen.has(otherId)) continue;
    seen.add(otherId);
    const other = allDepartments.find((d) => d.id === otherId);
    if (!other) continue;
    const otherFeedsUs = resolveDepartmentCourseScope(other, catalogId).secondaryDepartments.includes(department.name);
    const weFeedThem = ourSecondary.includes(other.name);
    if (!otherFeedsUs && !weFeedThem) conflicts.push(other);
  }
  return conflicts;
}

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
