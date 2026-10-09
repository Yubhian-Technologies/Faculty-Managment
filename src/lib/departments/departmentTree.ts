import type { Department } from "@/types";
import { departmentHasSections } from "@/lib/college/departmentSectionScope";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";

/**
 * One place that answers "what does picking this department mean?" for the
 * Department / Core Department filters, for every shape a college can be set up
 * in. Pure and name-based (like the data it reads), so the browser filters and
 * the server list routes cannot disagree.
 *
 * NOTHING here is a rule of its own. Every answer is derived from how the
 * departments are configured - `parentDepartmentId`, `hasSubDepartments`,
 * `parentRunsOwnSections`, `managedDepartments` - and from where sections are
 * actually filed. No department name, code, year or college is named anywhere.
 *
 * The shapes this has to hold together:
 *  - a parent that only organises sub-departments, with the sub-departments
 *    each managing core branches (Basic Science -> Basic Science - Maths ->
 *    AIDS/CSE);
 *  - standalone shared-first-year departments with no parent that manage core
 *    branches directly;
 *  - a core branch that holds no sections itself and is split into
 *    sub-branches that do (AI -> AIDS, AIML);
 *  - a core branch that DOES hold sections and also has a sub-department that
 *    does (ECE -> VLSI, CSE -> Cyber Security);
 *  - a plain department.
 *
 * Everything is ADDITIVE: a rollup always keeps the picked name itself, so a row
 * filed under it before it was split up is still matched, and a department that
 * runs its own sections behaves exactly as it always has.
 */

export type TreeDepartment = Pick<Department, "name"> &
  Partial<Pick<Department,
    | "hasSubDepartments" | "parentRunsOwnSections" | "managedDepartments" | "parentDepartmentId" | "isActive"
    // The other field a college may hold the same relationship in - see
    // groupedBranches below.
    | "secondaryDepartments" | "assignedYears" | "courseScopes"
  >> & {
    id?: string;
  };

const clean = (n: string | null | undefined) => (n ?? "").trim();

/**
 * The branches one department groups, from EITHER field a college configures
 * them in. Both say the same thing - "this department holds a shared year for
 * these branches" - and no department anywhere uses both:
 *
 *  - `managedDepartments` (VISHNU INSTITUTE OF TECHNOLOGY, dummy college)
 *  - `secondaryDepartments`, the cross-listing (VISHNU WOMEN'S UNIVERSITY,
 *    YUBHIAN, and siva's own "BASIC SCIENCE")
 *
 * Reading only the first left every department at the cross-listing colleges
 * with no Core Department filter at all: BASIC SCIENCE - MATHS groups
 * CSE [AI & DS] and CSE [AI & ML] there, and the filter never appeared.
 *
 * The cross-listing goes through resolveDepartmentCourseScope so a per-course
 * override wins over the flat field, as everywhere else that reads it.
 */
function groupedBranches<T extends TreeDepartment>(dept: T, catalogId?: string): string[] {
  return [
    ...(dept.managedDepartments ?? []),
    ...resolveDepartmentCourseScope(dept, catalogId).secondaryDepartments,
  ];
}

/** The sub-departments of `dept` (the hierarchy is one level deep). */
export function childrenOfDepartment<T extends TreeDepartment>(all: T[], dept: Pick<TreeDepartment, "id">): T[] {
  if (!dept.id) return [];
  return all.filter((d) => !!d.parentDepartmentId && d.parentDepartmentId === dept.id);
}

/**
 * A department that organises sub-departments and holds nothing of its own, so
 * nothing is ever filed under its name - the real rows sit under its children.
 *
 * Two independent signals, either is enough:
 *  - the Principal said so explicitly (`parentRunsOwnSections === false`), or
 *  - it has sub-departments and no section is filed under its own name
 *    (`hasOwnSections === false`, supplied by the caller from the section list).
 *
 * `hasOwnSections` omitted means "not known" - only the explicit flag is then
 * trusted, so nothing is guessed while the section list is still loading.
 */
export function isContainerDepartment<T extends TreeDepartment>(dept: T, all: T[], hasOwnSections?: boolean): boolean {
  if (!dept.hasSubDepartments) return false;
  if (childrenOfDepartment(all, dept).length === 0) return false;
  if (dept.parentRunsOwnSections === false) return true;
  return hasOwnSections === false;
}

/**
 * The department names a Department filter must match for `pickedName`: the
 * name itself plus, for a container, every sub-department. Any other department
 * - plain, standalone, or a parent that runs its own sections - returns just
 * its own name, exactly as the plain exact-name filter did.
 */
export function rollupDepartmentNames<T extends TreeDepartment>(all: T[], pickedName: string, hasOwnSections?: boolean): string[] {
  const name = clean(pickedName);
  if (!name) return [];
  const dept = all.find((d) => clean(d.name) === name);
  if (!dept || !isContainerDepartment(dept, all, hasOwnSections)) return [name];
  return Array.from(new Set([name, ...childrenOfDepartment(all, dept).map((c) => clean(c.name)).filter(Boolean)]));
}

/** Client-side convenience: the same rollup, deciding "holds nothing" from the section list. */
export function rollupDepartmentNamesForPick<T extends TreeDepartment>(
  all: T[],
  pickedName: string,
  sectionDepartmentNames: Iterable<string> | null
): string[] {
  const name = clean(pickedName);
  if (!sectionDepartmentNames) return rollupDepartmentNames(all, name);
  const have = new Set(Array.from(sectionDepartmentNames, clean));
  return rollupDepartmentNames(all, name, have.has(name));
}

/**
 * The branches a department hands a student to as their Core Department, from
 * the configuration alone: what it manages itself, what its sub-departments
 * manage, and - for each such name - that name's own sub-departments too.
 *
 * The last step is the same "a parent implies its children" rule the Add
 * Student form and the server's Core Department check already apply
 * (`secondaryDepartmentOptions`, `isConfiguredSecondaryDepartmentOrChild`): a
 * manager that groups a branch which is itself split into sub-branches (AI ->
 * AIDS, AIML) has students whose Core Department is the sub-branch.
 */
export function managedCoreCandidates<T extends TreeDepartment>(
  all: T[],
  dept: T | undefined,
  /** false = only what `dept` itself groups, not what its sub-departments group. */
  includeSubDepartmentsManaged = true
): string[] {
  if (!dept) return [];
  const names = new Set<string>();
  for (const n of groupedBranches(dept)) if (clean(n)) names.add(clean(n));
  if (includeSubDepartmentsManaged && dept.hasSubDepartments) {
    for (const child of childrenOfDepartment(all, dept)) {
      for (const n of groupedBranches(child)) if (clean(n)) names.add(clean(n));
    }
  }
  for (const n of Array.from(names)) {
    const managed = all.find((d) => clean(d.name) === n);
    if (managed) for (const c of childrenOfDepartment(all, managed)) if (clean(c.name)) names.add(clean(c.name));
  }
  return Array.from(names);
}

/**
 * The Core Department options for one or more picked departments (an HOD's
 * whole scope when nothing is picked): the candidates above that actually have
 * sections filed under them, sorted. A name configured but with no section
 * would be an option that can only come back empty, so it is left out - which
 * is also what drops a container such as AI while keeping AIDS and AIML.
 */
export function coreDepartmentOptions<T extends TreeDepartment>(
  all: T[],
  departmentNames: string[],
  sectionDepartmentNames: Iterable<string>
): string[] {
  const have = new Set(Array.from(sectionDepartmentNames, clean).filter(Boolean));
  const out = new Set<string>();
  for (const name of departmentNames) {
    const dept = all.find((d) => clean(d.name) === clean(name));
    for (const n of managedCoreCandidates(all, dept)) if (have.has(n)) out.add(n);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * Every active department as one ordered list, each sub-department directly
 * under its parent (indented), the rest in the caller's order. STRUCTURAL: it
 * never looks at sections, so an option never appears or disappears as data
 * loads - for a view whose Department list has always been "every department".
 * `container` marks a parent that holds nothing itself (see isContainerDepartment;
 * `sectionDepartmentNames` empty = only the explicit flag is trusted).
 */
export function groupDepartmentsByParent<T extends TreeDepartment>(
  all: T[],
  sectionDepartmentNames: Iterable<string> = [],
  /** A view that has always listed inactive departments too keeps doing so. */
  options: { includeInactive?: boolean } = {}
): DepartmentFilterOption<T>[] {
  const have = new Set(Array.from(sectionDepartmentNames, clean).filter(Boolean));
  const active = options.includeInactive ? [...all] : all.filter((d) => d.isActive !== false);
  const ids = new Set(active.map((d) => d.id).filter(Boolean));
  const byName = (a: T, b: T) => clean(a.name).localeCompare(clean(b.name));
  const container = (d: T) => isContainerDepartment(d, all, have.size > 0 ? have.has(clean(d.name)) : undefined);
  const out: DepartmentFilterOption<T>[] = [];
  const roots = active.filter((d) => !(d.parentDepartmentId && ids.has(d.parentDepartmentId))).sort(byName);
  for (const root of roots) {
    out.push({ department: root, depth: 0, container: container(root) });
    if (!root.id) continue;
    for (const child of active.filter((d) => d.parentDepartmentId === root.id).sort(byName)) {
      out.push({ department: child, depth: 1, container: container(child) });
    }
  }
  return out;
}

export interface DepartmentFilterOption<T> {
  department: T;
  /** 0 = top level, 1 = listed under its parent. Presentation only. */
  depth: 0 | 1;
  /** Picking it means "all of its sub-departments" (it holds nothing itself). */
  container: boolean;
}

/**
 * The Department dropdown, as one ordered list.
 *
 * Starts from the departments that resolve to sections (`departmentHasSections`
 * - a dead option that can only return nothing is not offered), then adds back
 * every container whose sub-departments are offered: picking it now means "all
 * of its sub-departments", so it is a real choice rather than a dead one.
 * Sub-departments are listed directly under their parent and indented; nothing
 * else about the order changes, so a college with no hierarchy sees the same
 * list in the same order.
 *
 * Falls back to every candidate when nothing qualifies (a college with no
 * sections yet), like the rule it builds on.
 */
export function departmentFilterOptions<T extends TreeDepartment>(
  candidates: T[],
  all: T[],
  sectionDepartmentNames: Iterable<string>
): DepartmentFilterOption<T>[] {
  const have = new Set(Array.from(sectionDepartmentNames, clean).filter(Boolean));
  const active = candidates.filter((d) => d.isActive !== false);
  const base = active.filter((d) => departmentHasSections(d, have));
  const kept: T[] = base.length > 0 ? [...base] : [...active];
  if (base.length > 0) {
    const keptNames = new Set(kept.map((d) => clean(d.name)));
    for (const d of active) {
      if (keptNames.has(clean(d.name))) continue;
      if (!isContainerDepartment(d, all, have.has(clean(d.name)))) continue;
      if (childrenOfDepartment(all, d).some((c) => keptNames.has(clean(c.name)))) {
        kept.push(d);
        keptNames.add(clean(d.name));
      }
    }
  }
  // Keep the caller's order; place each child right after its parent when the
  // parent is offered too.
  const order = new Map(candidates.map((d, i) => [d, i] as const));
  const byOrder = (a: T, b: T) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  const keptIds = new Set(kept.map((d) => d.id).filter(Boolean));
  const roots = kept.filter((d) => !(d.parentDepartmentId && keptIds.has(d.parentDepartmentId))).sort(byOrder);
  // The section list is only trusted when it names anything at all; with none
  // (the fallback above) just the explicit flag decides, as everywhere else.
  const known = have.size > 0;
  const container = (d: T) => isContainerDepartment(d, all, known ? have.has(clean(d.name)) : undefined);
  const out: DepartmentFilterOption<T>[] = [];
  for (const root of roots) {
    out.push({ department: root, depth: 0, container: container(root) });
    if (!root.id) continue;
    for (const child of kept.filter((d) => d.parentDepartmentId === root.id).sort(byOrder)) {
      out.push({ department: child, depth: 1, container: container(child) });
    }
  }
  return out;
}
