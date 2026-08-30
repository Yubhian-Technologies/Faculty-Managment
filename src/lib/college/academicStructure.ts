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
import type { Course, Department, DepartmentCourseScope } from "@/types";

export type DepartmentWithId = Department & { id: string };

/**
 * Which of a course catalog entry's own regulations govern a given ordinal
 * year of that course, AS OF a given session - see
 * academicSession.ts's regulationsForCourseYearByBatch, which this just
 * forwards to with the catalog entry's own `regulationBatches`. Kept here
 * too (re-exported) so every caller can import course-scoped regulation
 * resolution from this one file regardless of which piece it needs.
 */
export { regulationsForCourseYearByBatch } from "@/lib/college/academicSession";

/**
 * The catalog course a department's own Course doc resolves `courseName` to -
 * needed to look up that course's per-course override in
 * Department.courseScopes (resolveDepartmentCourseScope). Prefers the
 * department's own Course doc; falls back to any other department's Course
 * doc with the same name (a department that inherits a course through a
 * common first-year feeder, rather than owning it directly, has none of its
 * own) - safe because the course catalog itself prevents two entries sharing
 * a name, so any Course doc named "Master of Technology" always points to the
 * same catalog id. Isomorphic (client roster forms and the students API both
 * import this) so the two never resolve a student's per-course year override
 * differently.
 */
export function resolveCatalogId(courses: Course[], departmentId: string | undefined, courseName: string | undefined): string | undefined {
  if (!courseName) return undefined;
  return (
    courses.find((c) => c.departmentId === departmentId && c.name === courseName)
    ?? courses.find((c) => c.name === courseName)
  )?.catalogId;
}

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
 * Whether `feederDept` explicitly cross-lists to `receivingDeptName` for this
 * exact `year`/`catalogId` - the precise, per-year/per-course check that
 * makes it safe to grant a receiving department's HOD view-only access to a
 * feeder's sections (see sections/route.ts GET). Deliberately NOT a blanket
 * "receivingDeptName is somewhere in feederDept.secondaryDepartments" check -
 * that alone conflates "years/courses this feeder has actually reserved for
 * itself" with "years the receiving department happens to be named for a
 * totally different course", which is the exact bug this route's own history
 * (see its block comment) warns against. Built on resolveDepartmentCourseScope
 * so a per-course override is honored the same way every other caller of it is.
 */
export function isDeclaredFeederFor(
  feederDept: Pick<Department, "assignedYears" | "secondaryDepartments" | "courseScopes">,
  receivingDeptName: string,
  year: number,
  catalogId: string | undefined | null
): boolean {
  const scope = resolveDepartmentCourseScope(feederDept, catalogId);
  return scope.secondaryDepartments.includes(receivingDeptName) && scope.assignedYears.includes(year);
}

/**
 * Years `department` does NOT teach itself for `catalogId`, even if its own
 * assignedYears (flat or per-course override) says nothing about them - years
 * some OTHER department has claimed as a feeder for this one
 * (secondaryDepartments, resolved the same catalog-aware way - see
 * resolveSubjectDepartment, which is what actually files a fed year's
 * subjects under the feeder instead of `department`). A department's own
 * assignedYears is supposed to already exclude whatever a feeder claims, but
 * a department left unconfigured (assignedYears never set) falls back to
 * offering every year it structurally can't own - this closes that gap.
 * Callers building a "years this department teaches" list should always
 * subtract this, not just trust assignedYears on its own.
 */
export function fedYears(
  department: Pick<Department, "name">,
  allDepartments: Department[],
  catalogId: string | undefined | null
): number[] {
  const years = new Set<number>();
  for (const feeder of allDepartments) {
    // A feeder's FLAT fields are a department-wide default, not scoped to any
    // one course - falling back to them here for a specific catalogId the
    // feeder may not even offer would treat a totally unrelated department
    // (e.g. one that runs a different program entirely) as "feeding" this
    // course's years, purely because its flat secondaryDepartments happens to
    // name `department` for a DIFFERENT course (e.g. Chemistry's own B.Tech
    // cross-listing to civil engineering, wrongly reused when resolving civil
    // engineering's unrelated, independent M.Tech - Chemistry doesn't run an
    // M.Tech at all). Once a catalogId is given, only an EXPLICIT per-course
    // override actually establishes a feeding relationship for it - every
    // course that's actually cross-listed for that catalogId has one (set at
    // course creation, mandatory - see college/courses POST). `catalogId`
    // omitted (a legacy, pre-catalog lookup) keeps the flat fallback,
    // unchanged from before per-course overrides existed.
    const scope = catalogId
      ? feeder.courseScopes?.[catalogId]
      : { assignedYears: feeder.assignedYears ?? [], secondaryDepartments: feeder.secondaryDepartments ?? [] };
    if (!scope) continue;
    if (!scope.secondaryDepartments.includes(department.name)) continue;
    for (const y of scope.assignedYears) years.add(y);
  }
  return Array.from(years);
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
 * Every year `d` claims anywhere - its flat assignedYears (the legacy default,
 * no longer settable from the Add/Edit Department forms but still honored for
 * departments configured before per-course scoping existed) unioned with every
 * per-course override's own assignedYears. Years taught is now decided per
 * course (see Department.courseScopes), so structural checks that used to read
 * the flat field alone - "does this department claim year 1 at all" - must
 * look at both, or a department configured purely through courseScopes would
 * look unconfigured.
 */
function allClaimedYears(d: Pick<Department, "assignedYears" | "courseScopes">): number[] {
  const years = new Set<number>(d.assignedYears ?? []);
  for (const s of Object.values(d.courseScopes ?? {})) for (const y of s.assignedYears) years.add(y);
  return Array.from(years).sort((a, b) => a - b);
}

/**
 * A department qualifies as A shared first-year department when it claims
 * year 1 AND acts as a shared parent - either by being split into
 * sub-departments (`hasSubDepartments`) or by cross-listing the branches it
 * feeds (`secondaryDepartments`). A plain department that merely teaches year 1
 * for its own branch matches neither and is correctly left alone.
 *
 * Exported - unlike the rest of this file's internals - because a college can
 * genuinely have MORE THAN ONE such department at once, each independent of
 * the others: e.g. Chemistry, English, Maths and Physics each separately
 * claiming year 1 and cross-listing to different real branches, with no
 * parent-department layer tying them together (SHRI VISHNU ENGINEERING
 * COLLEGE FOR WOMEN's actual shape). `structureFromDepartments`'s own
 * `commonDepartment` below picks exactly ONE of these deterministically -
 * correct and necessary for its callers (cohort distribution, promotion),
 * which structurally need a single department to act on - but wrong for a
 * purely presentational "is this department one of the shared first-year
 * ones" question, which every qualifying department should answer yes to.
 * See getFreshmanDepartmentIds below for that latter use.
 */
export function isCommonYearDepartment(d: DepartmentWithId): boolean {
  if (d.isActive === false) return false;
  if (d.parentDepartmentId) return false; // sub-departments never qualify
  if (!allClaimedYears(d).includes(1)) return false;
  return Boolean(d.hasSubDepartments) || (d.secondaryDepartments ?? []).length > 0;
}

/**
 * Every department that qualifies as A shared/common first-year department
 * (isCommonYearDepartment) - not just the single one `structureFromDepartments`
 * picks as `commonDepartment`. Powers the "Freshman's Department" badge
 * (FreshmanDepartmentBadge and its inline picker annotations in
 * DepartmentScopeSelect/hod/sections), which must mark EVERY such department,
 * not just whichever one the deterministic tie-break happens to prefer -
 * see isCommonYearDepartment's own doc-comment for why the two answers
 * legitimately differ.
 */
export function getFreshmanDepartmentIds(allDepartments: DepartmentWithId[]): Set<string> {
  return new Set(allDepartments.filter(isCommonYearDepartment).map((d) => d.id));
}

/**
 * The department NAMES a Year-1 student may be filed directly under, for a
 * college that runs a shared/common first year - every qualifying freshman
 * department itself (the STANDALONE shape: Chemistry/Physics/Maths/English
 * each independently claiming year 1 and cross-listing branches via their own
 * `secondaryDepartments` - e.g. SHRI VISHNU ENGINEERING COLLEGE FOR WOMEN),
 * plus every actual sub-department of one (the PARENT-with-sub-departments
 * shape: "Basic Science" split into "Basic Science - Chemistry" etc via
 * `parentDepartmentId` - e.g. VISHNU INSTITUTE OF TECHNOLOGY). A real branch
 * (IT, CSBS, ...) is deliberately excluded even though it's a perfectly valid
 * Department for years 2-4 - a 1st year's real branch belongs in
 * `secondaryDepartment` ("Core Department") instead, set once and promoted
 * out of after year 1 (see students/route.ts POST and the bulk importer's
 * unassigned rows, which both enforce this against the raw text a caller
 * supplies).
 *
 * Empty for a college with no shared first year at all (isCommonYearDepartment
 * never matches) - callers should treat an empty set as "no restriction",
 * matching how every other check in this file infers structure from the data
 * rather than a stored flag (see this file's own top-of-file doc-comment).
 */
export function freshmanLandingDepartmentNames(allDepartments: DepartmentWithId[]): Set<string> {
  const freshmanIds = getFreshmanDepartmentIds(allDepartments);
  const names = new Set<string>();
  for (const d of allDepartments) {
    if (!d.name) continue;
    if (d.parentDepartmentId && freshmanIds.has(d.parentDepartmentId)) {
      // A child of a qualifying parent is always a valid landing name,
      // unconditionally - it's the one place a 1st-year genuinely sits,
      // regardless of whether the parent itself also does.
      names.add(d.name);
    } else if (freshmanIds.has(d.id)) {
      // The department qualifies as freshman on its own. Include its own
      // name UNLESS it's explicitly flagged as a pure organizing container
      // with no sections of its own (parentRunsOwnSections === false, the
      // VISHNU "BASIC SCIENCE" shape) - see that field's own doc-comment
      // (src/types/core.ts). Unset/true keeps today's behavior (the
      // STANDALONE shape, and any parent that genuinely does run its own
      // sections alongside its children).
      if (d.parentRunsOwnSections !== false) {
        names.add(d.name);
      }
    }
  }
  return names;
}

/**
 * The real children of `name`, when `name` is a "no own sections" shared-
 * first-year parent - a pure organizing container (parentRunsOwnSections
 * === false, see that field's own doc-comment in src/types/core.ts) that
 * itself never houses a student or section. Returns null for every other
 * department (a plain branch, a standalone freshman department with no
 * parent, or a hasSubDepartments parent that DOES run its own sections) -
 * the single place this flag is actually consulted, so both the write-time
 * remap (resolveFreshmanLandingDepartment, managedBranches.ts) and the
 * read-time rollup (expandDepartmentNameForRollup below) agree on exactly
 * which departments this applies to.
 */
export function noOwnSectionsChildren(allDepartments: DepartmentWithId[], name: string): DepartmentWithId[] | null {
  const parent = allDepartments.find((d) => d.name === name);
  if (!parent || !parent.hasSubDepartments || parent.parentRunsOwnSections !== false) return null;
  return allDepartments.filter((d) => d.parentDepartmentId === parent.id);
}

/**
 * Expands a single filter/export/query department NAME into the full set of
 * names to actually match against - `name` itself, plus (when `name` is a
 * "no own sections" shared-first-year parent - see noOwnSectionsChildren)
 * every one of its real children too, since no student is ever filed
 * directly under such a parent. Deliberately ADDITIVE (always keeps `name`
 * itself) rather than narrowing, so a stray pre-migration document is never
 * hidden by this expansion. A no-op (`[name]`) for every other department -
 * a plain branch, a standalone freshman department, or a parent that
 * genuinely does run its own sections - so filtering/exporting by one of
 * those behaves exactly as it always has.
 */
export function expandDepartmentNameForRollup(allDepartments: DepartmentWithId[], name: string): string[] {
  if (!name) return [];
  const children = noOwnSectionsChildren(allDepartments, name);
  if (!children) return [name];
  return Array.from(new Set([name, ...children.map((c) => c.name)]));
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
    commonYears: commonDepartment ? allClaimedYears(commonDepartment) : [],
    subDepartments: commonDepartment
      ? allDepartments.filter((d) => d.parentDepartmentId === commonDepartment.id)
      : [],
    managedBranchOwner,
    allDepartments,
  };
}
