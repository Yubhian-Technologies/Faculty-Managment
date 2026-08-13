import { findBranchManager } from "@/lib/departments/managedBranches";
import type { Course, Department } from "@/types";

// Client-side counterpart to getHodDepartmentScope (which is server-only, since
// it reads Firestore): the same "what does this HOD actually run" question,
// answered from the departments list a page has already fetched.
//
// Extracted from hod/sections/page.tsx, which worked this out first and is
// still the reference for the behaviour. hod/teaching-assignments needed the
// identical answers, and re-deriving them there had already produced one bug
// (its Course list covered only the HOD's own department, so shared-year
// sections filed against a branch's own Course doc were invisible) - so this
// lives in one place rather than two.

/**
 * The real departments in scope - never a grouping container (a sub-department
 * or common parent that exists only to organize others). See `deriveHodScope`
 * for the two shapes this covers.
 */
export function resolveScopeDepartments(
  ownDept: Department | null,
  departments: Department[],
  isGroupingContainer: boolean,
  useCascadeFilter: boolean,
  groupingChildren: Department[],
  plainChildren: Department[]
): Department[] {
  if (!ownDept) return [];
  if (useCascadeFilter) {
    const managedBranches = groupingChildren.flatMap((c) =>
      departments.filter((d) => (c.managedDepartments ?? []).includes(d.name))
    );
    return [...plainChildren, ...managedBranches];
  }
  const children = departments.filter((d) => d.parentDepartmentId === ownDept.id);
  const managed = departments.filter((d) => (ownDept.managedDepartments ?? []).includes(d.name));
  return isGroupingContainer ? [...children, ...managed] : [ownDept, ...children, ...managed];
}

export interface HodScope {
  ownDept: Department | null;
  isGroupingContainer: boolean;
  groupingChildren: Department[];
  plainChildren: Department[];
  useCascadeFilter: boolean;
  /** The real departments whose courses/sections this HOD works with. */
  deptOptions: Department[];
  /**
   * Whether this HOD reaches branches THROUGH a managed relationship - as the
   * common HOD via the cascade, or as the sub-HOD who is the grouping
   * container. A branch's own dedicated HOD is neither, even when some
   * sub-department elsewhere manages that same branch for a shared year: that
   * year is never theirs, so the manager's years must not apply to them.
   */
  viewsManagedBranchYears: boolean;
}

/** Everything above, derived in one call from a departments list + who's asking. */
export function deriveHodScope(departments: Department[], ownDepartmentName: string | undefined): HodScope {
  const ownDept = departments.find((d) => d.name === ownDepartmentName) ?? null;
  const isGroupingContainer = (ownDept?.managedDepartments?.length ?? 0) > 0;
  const groupingChildren = ownDept
    ? departments.filter((d) => d.parentDepartmentId === ownDept.id && (d.managedDepartments?.length ?? 0) > 0)
    : [];
  const plainChildren = ownDept
    ? departments.filter((d) => d.parentDepartmentId === ownDept.id && (d.managedDepartments?.length ?? 0) === 0)
    : [];
  const useCascadeFilter = !isGroupingContainer && Boolean(ownDept?.hasSubDepartments) && groupingChildren.length > 0;
  return {
    ownDept,
    isGroupingContainer,
    groupingChildren,
    plainChildren,
    useCascadeFilter,
    deptOptions: resolveScopeDepartments(ownDept, departments, isGroupingContainer, useCascadeFilter, groupingChildren, plainChildren),
    viewsManagedBranchYears: useCascadeFilter || isGroupingContainer,
  };
}

export type CourseGroup = { key: string; name: string; durationYears: number; courseIds: string[] };

/**
 * Collapse the several Course docs that represent one programme into a single
 * choice. Every department owns its own "Bachelor of Technology" row, so a
 * scope covering Basic Science + CIVIL + ECE yields three identical-looking
 * courses, each matching only the sections that happen to store its own id.
 * Grouped by catalog id, falling back to the normalized name for courses
 * created before the catalog existed; `courseIds` keeps every underlying id so
 * one choice can filter across all of them.
 */
export function buildCourseGroups(courses: Course[]): CourseGroup[] {
  const map = new Map<string, CourseGroup>();
  for (const c of courses) {
    const key = c.catalogId ?? `name:${c.name.trim().toLowerCase()}`;
    const g = map.get(key);
    if (g) {
      g.courseIds.push(c.id);
      if (!g.name && c.name) g.name = c.name;
    } else {
      map.set(key, { key, name: c.name, durationYears: c.durationYears, courseIds: [c.id] });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * branch name -> the years its managing (sub-)department teaches. A real
 * branch's own "Years Taught" never includes a shared year like the common
 * first year, so anything scoped by assignedYears has to fall back to this for
 * a managed branch or the shared year disappears entirely.
 */
export function managedBranchYearsMap(departments: Department[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const d of departments) {
    for (const branchName of d.managedDepartments ?? []) {
      if (m.has(branchName)) continue;
      m.set(branchName, findBranchManager(departments, branchName)?.years ?? []);
    }
  }
  return m;
}

/**
 * The years to offer for a course: the "Years Taught" the Principal assigned
 * across the departments in play, intersected with the course's own span -
 * never the raw 1..durationYears, which is what let Teaching Assignments offer
 * years the department doesn't run. Falls back to the full span when nothing is
 * assigned anywhere, so an unconfigured college isn't locked out.
 */
export function yearsInScope(
  durationYears: number,
  relevantDepartments: Department[],
  managedBranchYears: Map<string, number[]>,
  viewsManagedBranchYears: boolean
): number[] {
  const courseYears = Array.from({ length: durationYears }, (_, i) => i + 1);
  const assigned = new Set<number>();
  for (const d of relevantDepartments) {
    for (const y of d.assignedYears ?? []) assigned.add(y);
    if (viewsManagedBranchYears) {
      for (const y of managedBranchYears.get(d.name) ?? []) assigned.add(y);
    }
  }
  return assigned.size > 0 ? courseYears.filter((y) => assigned.has(y)) : courseYears;
}
