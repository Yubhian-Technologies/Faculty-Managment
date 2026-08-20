// Shared "type either the full name or the short Code" matching used by bulk
// imports (student roster, supporting staff) and, client-side, by the import
// review UI's "fix this failed row" dialog - one implementation instead of
// three near-identical copies. Pure functions over plain objects (not
// Firestore snapshots) so a server route (map its snapshot docs once) and a
// client page (already has plain JSON from `fetch`) can call the exact same
// code.

/**
 * Resolves a raw Department cell - either its full name (e.g. "Information
 * Technology") or its short Code (e.g. "IT") - to the department's canonical
 * `name`, case-insensitively and trimmed. Returns undefined when nothing
 * matches.
 */
export function resolveDepartmentByNameOrCode(
  departments: { name?: string; code?: string }[],
  input: string
): string | undefined {
  const needle = input.trim().toLowerCase();
  if (!needle) return undefined;
  const byCodeOrName = new Map<string, string>();
  for (const d of departments) {
    const name = (d.name ?? "").trim();
    if (!name) continue;
    byCodeOrName.set(name.toLowerCase(), name);
    const code = (d.code ?? "").trim();
    if (code) byCodeOrName.set(code.toLowerCase(), name);
  }
  return byCodeOrName.get(needle);
}

/**
 * Resolves a raw Course cell - either its full name (e.g. "Bachelor of
 * Technology") or its short Code (e.g. "BTECH") - to the course's canonical
 * `name`, scoped to courses actually owned by `departmentId`. Mirrors
 * courseNamesForDepartment's direct-ownership rule (src/components/students/
 * RosterFieldInputs.tsx) - deliberately no parent/feeder fallback, since a
 * row that names a department writes that department verbatim and has no use
 * for a course it doesn't itself offer. Returns undefined when nothing
 * matches (including when departmentId is empty/unresolved).
 */
export function resolveCourseByNameOrCode(
  courses: { name?: string; code?: string; departmentId?: string }[],
  departmentId: string,
  input: string
): string | undefined {
  const needle = input.trim().toLowerCase();
  if (!needle || !departmentId) return undefined;
  const byCodeOrName = new Map<string, string>();
  for (const c of courses) {
    if (c.departmentId !== departmentId) continue;
    const name = (c.name ?? "").trim();
    if (!name) continue;
    byCodeOrName.set(name.toLowerCase(), name);
    const code = (c.code ?? "").trim();
    if (code) byCodeOrName.set(code.toLowerCase(), name);
  }
  return byCodeOrName.get(needle);
}

/**
 * True when `candidate` is actually one of `department`'s configured
 * Secondary Departments - its flat `secondaryDepartments`, OR any per-course
 * override's `secondaryDepartments` (Department.courseScopes - a department
 * can cross-list differently per course). Case/whitespace-insensitive, same
 * as every other department-name comparison (college/departments already
 * enforces name uniqueness case-insensitively, so this can never conflate
 * two different real departments).
 *
 * Every write path that accepts a free-typed or otherwise client-supplied
 * Secondary Department (bulk student import's unassigned rows, the manual
 * Add Student unassigned path, and the roster-details edit path) must check
 * this - without it, a student can be saved cross-listed to a branch the
 * department never actually configured (e.g. "Physics" registering a student
 * to "civil engineering", which Physics doesn't cross-list to at all), and
 * that bogus value then surfaces as a real-looking option everywhere
 * Secondary Department values get read back out of existing students (e.g.
 * the Distribute Unassigned dialog's branch picker).
 */
export function isConfiguredSecondaryDepartment(
  department: { secondaryDepartments?: string[]; courseScopes?: Record<string, { secondaryDepartments?: string[] }> },
  candidate: string
): boolean {
  const target = candidate.trim().toLowerCase();
  if (!target) return false;
  const matches = (arr: string[] | undefined) => (arr ?? []).some((s) => s.trim().toLowerCase() === target);
  if (matches(department.secondaryDepartments)) return true;
  for (const scope of Object.values(department.courseScopes ?? {})) {
    if (matches(scope.secondaryDepartments)) return true;
  }
  return false;
}

/**
 * Same as isConfiguredSecondaryDepartment, but also accepts `candidate` when
 * it's a SUB-department of an entry that IS configured - e.g. configuring
 * plain "Electronics and Communication Engineering" as a Core Department
 * implicitly authorizes any of its sub-departments too ("ECE-VLSI"), for
 * students admitted straight into that sub-department rather than the plain
 * branch (see hod/sections/new's "Sub-Department" picker, which offers
 * exactly this without needing the sub-department separately, individually
 * configured). `candidateParentName` is the CANDIDATE's own
 * parentDepartmentId's name (not `department`'s) - callers already have the
 * full department list loaded wherever this matters, so it's resolved there
 * rather than here (this file stays pure - no DB access).
 */
export function isConfiguredSecondaryDepartmentOrChild(
  department: { secondaryDepartments?: string[]; courseScopes?: Record<string, { secondaryDepartments?: string[] }> },
  candidate: string,
  candidateParentName?: string
): boolean {
  if (isConfiguredSecondaryDepartment(department, candidate)) return true;
  if (candidateParentName) return isConfiguredSecondaryDepartment(department, candidateParentName);
  return false;
}

/**
 * Array-based counterpart of isConfiguredSecondaryDepartmentOrChild, for a
 * caller that's already resolved its own already-merged list of allowed
 * names (college/sections POST/PATCH's `availableSecondaryDepts`/`available`,
 * which fold together a department's own configured branches with whatever
 * it inherits from a parent) rather than holding a single Department object
 * to check against. Same semantics: `candidate` is allowed either directly,
 * or as a sub-department of an allowed entry.
 */
export function isNameOrChildAmong(
  allowedNames: string[],
  candidate: string,
  candidateParentName?: string
): boolean {
  const target = candidate.trim().toLowerCase();
  if (!target) return false;
  const matches = (name: string) => name.trim().toLowerCase() === target;
  if (allowedNames.some(matches)) return true;
  if (candidateParentName) {
    const parentTarget = candidateParentName.trim().toLowerCase();
    return allowedNames.some((n) => n.trim().toLowerCase() === parentTarget);
  }
  return false;
}
