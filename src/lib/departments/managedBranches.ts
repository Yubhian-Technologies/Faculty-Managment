// A branch (top-level department such as IT or CSBS) may be grouped under at
// most ONE sub-department. Grouping is what grants a Sub-HOD full control of
// that branch's students and sections (Department.managedDepartments, resolved
// by getHodDepartmentScope), so letting two sub-departments claim the same
// branch would hand two different Sub-HODs write access to the same roster with
// no way to say which one owns it - and would make "distribute this branch's
// students" ambiguous. The rule is enforced on write, here.
//
// Shared by the create and update paths in college/departments/route.ts, which
// each already hold a full read of the departments collection.

import { resolveDepartmentCourseScope, noOwnSectionsChildren, type DepartmentWithId } from "@/lib/college/academicStructure";
import type { DepartmentCourseScope } from "@/types";

export interface DepartmentClaimRow {
  id: string;
  name?: string;
  managedDepartments?: string[];
}

export interface BranchClaimConflict {
  branch: string;
  ownedBy: string;
}

/**
 * Returns the branches in `names` that some OTHER department already manages.
 * `selfId` is the department being created or updated - its own existing
 * claims never conflict with itself, so re-saving an unchanged list is a no-op.
 */
export function findBranchClaimConflicts(
  departments: DepartmentClaimRow[],
  names: string[],
  selfId?: string
): BranchClaimConflict[] {
  const wanted = new Set(names.map((n) => n.trim()).filter(Boolean));
  if (wanted.size === 0) return [];

  const conflicts: BranchClaimConflict[] = [];
  for (const d of departments) {
    if (selfId && d.id === selfId) continue;
    for (const claimed of d.managedDepartments ?? []) {
      const branch = claimed.trim();
      if (branch && wanted.has(branch)) {
        conflicts.push({ branch, ownedBy: d.name ?? "another sub-department" });
      }
    }
  }
  return conflicts;
}

/** The 409 message shown when a branch is already grouped elsewhere. */
export function branchClaimConflictMessage(conflicts: BranchClaimConflict[]): string {
  return conflicts
    .map((c) => `"${c.branch}" is already managed by "${c.ownedBy}". Remove it there first.`)
    .join(" ");
}

export interface DepartmentYearRow extends DepartmentClaimRow {
  assignedYears?: number[];
  parentDepartmentId?: string;
  // Only read by findBranchManager's parent fallback below, to recognize a
  // "no own sections" shared-first-year parent (see noOwnSectionsChildren,
  // academicStructure.ts). Optional because every caller already passes whole
  // department documents - nothing has to start supplying a new field.
  hasSubDepartments?: boolean;
  parentRunsOwnSections?: boolean;
  // Per-course override of assignedYears (Department.courseScopes) - a
  // manager can run more than one course with different years (e.g. Chemistry
  // sharing a B.Tech's first year while also running an independent course of
  // its own), so ownership must be resolved per the course actually in
  // question (`catalogId` below), not always the manager's flat years.
  courseScopes?: Record<string, DepartmentCourseScope>;
}

export interface BranchManager<T> {
  department: T;
  /** Years the manager actually teaches for the given catalogId - its own
   * per-course override or flat assignedYears, or, if it has neither of its
   * own (the common shape for a sub-department), its parent common
   * department's. */
  years: number[];
}

/**
 * The department that manages `branchName` via `Department.managedDepartments`
 * (e.g. a sub-department like "BS-English" grouping "CIVIL" for the shared
 * first year), and the years it actually teaches for `catalogId`. A branch is
 * only reached through its manager for THOSE years - every other year belongs
 * to the branch's own dedicated HOD (Department.assignedYears/courseScopes on
 * the branch itself). Mirrors resolveSubjectDepartment's rule for the older
 * secondaryDepartments mechanism, generalized to managedDepartments. Returns
 * null when nothing manages this branch.
 */
export function findBranchManager<T extends DepartmentYearRow>(
  departments: T[],
  branchName: string,
  catalogId?: string
): BranchManager<T> | null {
  const manager = departments.find((d) => (d.managedDepartments ?? []).includes(branchName))
    ?? findManagerViaNoOwnSectionsParent(departments, branchName);
  if (!manager) return null;
  return { department: manager, years: managerTeachingYears(departments, manager, catalogId) };
}

/**
 * Fallback for a branch nothing manages BY NAME: when its parent is a "no own
 * sections" shared-first-year parent (parentRunsOwnSections === false - see
 * noOwnSectionsChildren, academicStructure.ts) and something manages THAT
 * parent, the child inherits the relationship.
 *
 * This is what makes grouping such a parent actually work. Grouping "AI" under
 * BS-ENGLISH says BS-ENGLISH runs AI's shared first year - but AI itself never
 * houses a section (the flag is exactly that statement, and
 * `api/college/sections` POST enforces it), so every real section lands under
 * AIML/AIDS instead. Without this, those sections would resolve to no manager
 * at all: the shared first year would be rejected on write and the sections
 * would be invisible to the very HOD who created them.
 *
 * Deliberately only consulted when no direct manager exists, and only through
 * a parent carrying that explicit Principal-set flag - a branch grouped in its
 * own right, and any ordinary parent/child pair, resolve exactly as before.
 */
function findManagerViaNoOwnSectionsParent<T extends DepartmentYearRow>(
  departments: T[],
  branchName: string
): T | undefined {
  const parentName = noOwnSectionsParentNameOf(departments, branchName);
  if (!parentName) return undefined;
  return departments.find((d) => (d.managedDepartments ?? []).includes(parentName));
}

/**
 * The name of `branchName`'s parent, when that parent is a "no own sections"
 * one (parentRunsOwnSections === false). Undefined for everything else - a
 * top-level department, or a child of a parent that does run its own sections.
 *
 * This is the "a child stands in for its flagged parent" rule in one place.
 * Every picker now offers such a parent's CHILDREN in its stead
 * (replaceNoOwnSectionsParents, academicStructure.ts), so anything that used
 * to be looked up by the parent's name has to accept a child's name and
 * resolve back up - otherwise a relationship configured on the parent
 * silently stops applying the moment a user picks what the UI actually offers.
 */
export function noOwnSectionsParentNameOf<T extends DepartmentYearRow>(
  departments: T[],
  branchName: string
): string | undefined {
  const branch = departments.find((d) => d.name === branchName);
  if (!branch?.parentDepartmentId) return undefined;
  const parent = departments.find((d) => d.id === branch.parentDepartmentId);
  if (!parent?.name || !parent.hasSubDepartments || parent.parentRunsOwnSections !== false) return undefined;
  return parent.name;
}

/**
 * The years a managing department actually teaches for `catalogId`: its own
 * per-course override or flat assignedYears (resolveDepartmentCourseScope),
 * or, when it has neither of its own (the common shape for a sub-department,
 * which college/departments POST won't let an HOD set), its parent common
 * department's.
 *
 * Exported because a manager isn't always found by searching for it - the Add
 * Section cascade knows which container it routed a branch through, and a
 * branch can be reachable through more than one (grouped under a
 * sub-department AND directly under the common parent). Those callers need
 * this same rule applied to the manager they already hold.
 */
export function managerTeachingYears<T extends DepartmentYearRow>(
  departments: T[],
  manager: T,
  catalogId?: string
): number[] {
  const own = resolveDepartmentCourseScope(manager, catalogId).assignedYears;
  if (own.length > 0) return own;
  if (manager.parentDepartmentId) {
    const parent = departments.find((p) => p.id === manager.parentDepartmentId);
    return parent ? resolveDepartmentCourseScope(parent, catalogId).assignedYears : [];
  }
  return [];
}

/**
 * Whichever department actually owns (branchName, year) for `catalogId`: the
 * manager, if one manages this branch and teaches this year for this course -
 * otherwise the branch itself. Used to decide access/visibility: a branch's
 * own dedicated HOD should never see a section for a year their manager owns
 * instead, and vice versa. `catalogId` omitted falls back to each
 * department's flat fields only, same as before per-course overrides existed.
 */
export function resolveBranchYearOwner<T extends DepartmentYearRow & { name?: string }>(
  departments: T[],
  branchName: string,
  year: number,
  catalogId?: string
): string {
  const manager = findBranchManager(departments, branchName, catalogId);
  return manager && manager.years.includes(year) ? (manager.department.name ?? branchName) : branchName;
}

/**
 * Year-aware counterpart of `canHodEditDepartment` (scope.ts) - true when
 * `departmentName` at `year` is actually this HOD's to read/write. A true
 * sub-department (childDepartmentNames) is owned outright, no year check -
 * only a MANAGED branch (an owned department, or a grouped branch reached via
 * `managedDepartments`) is year-scoped, since that's the relationship split
 * between a shared-year manager and the branch's own dedicated HOD.
 * Mirrors the inline check `college/sections` GET already applies per
 * section - the students routes (list, distribute, per-student edit) need
 * the exact same rule so a manager can never see or move a branch's
 * non-shared-year students, and the branch's own HOD can never see or move
 * the shared-year ones. `departments` must be the full department list (for
 * `resolveBranchYearOwner` to resolve who manages `departmentName`).
 *
 * An HOD can own more than one department directly (see
 * src/lib/departments/scope.ts) - `ownDepartmentNames` is the full set, not
 * a single name, so a manager relationship set up on ANY of them (e.g. a
 * plain top-level "Maths" department grouping AIDS/AIML for their shared
 * first year, with no common parent department involved at all) resolves
 * correctly.
 */
/**
 * Resolves the department a student should actually be STORED under, when
 * `resolvedDepartmentName` might be a "no own sections" shared-first-year
 * parent (Department.parentRunsOwnSections === false - see its own
 * doc-comment, src/types/core.ts - e.g. VISHNU INSTITUTE OF TECHNOLOGY's
 * "BASIC SCIENCE") and `coreDepartmentName` names the real branch a 1st-year
 * is headed for. Such a parent never itself houses a student - the real
 * landing spot is whichever of its children actually manages that branch
 * (Department.managedDepartments) - so this remaps the parent's name to that
 * child's, e.g. "BASIC SCIENCE" + Core Department "AIDS" -> "Basic Science -
 * Maths". A caller may submit either the bare parent or an already-correct
 * child directly; both produce the same, correct final name.
 *
 * Returns `resolvedDepartmentName` unchanged when there's no Core Department
 * given, when it isn't a no-own-sections parent (noOwnSectionsChildren
 * returns null - a plain branch, a standalone freshman department, or a
 * parent that genuinely runs its own sections, e.g. SHRI VISHNU ENGINEERING
 * COLLEGE FOR WOMEN's "ECE"), or when none of its children actually manage
 * `coreDepartmentName`. That last case is deliberately a no-op, not an error
 * - isConfiguredSecondaryDepartmentOrChild (codeOrNameResolver.ts), run
 * independently by every caller right after this, is the single source of
 * truth for whether a Core Department is valid at all; this resolver never
 * duplicates that check, only acts on a relationship it already knows how to
 * validate.
 */
export function resolveFreshmanLandingDepartment(
  allDepartments: DepartmentWithId[],
  resolvedDepartmentName: string,
  coreDepartmentName: string | undefined
): string {
  if (!coreDepartmentName) return resolvedDepartmentName;
  const children = noOwnSectionsChildren(allDepartments, resolvedDepartmentName);
  if (!children) return resolvedDepartmentName;
  // The Core Department may be a child standing in for a flagged parent the
  // manager actually groups (AIML offered in place of AI - see
  // noOwnSectionsParentNameOf). `children` is deliberately only this parent's
  // own sub-departments, so that resolution is done against the FULL list
  // first, then the manager is looked up among the children as before.
  const managedName = findBranchManager(children, coreDepartmentName)
    ? coreDepartmentName
    : noOwnSectionsParentNameOf(allDepartments, coreDepartmentName) ?? coreDepartmentName;
  const manager = findBranchManager(children, managedName);
  return manager ? manager.department.name : resolvedDepartmentName;
}

export function canHodEditDepartmentYear<T extends DepartmentYearRow & { name?: string }>(
  scope: { ownDepartmentNames: string[]; childDepartmentNames: string[]; managedDepartmentNames: string[] },
  departments: T[],
  departmentName: string,
  year: number,
  catalogId?: string
): boolean {
  if (!departmentName || scope.ownDepartmentNames.length === 0) return false;
  if (scope.childDepartmentNames.includes(departmentName)) return true;
  if (!scope.ownDepartmentNames.includes(departmentName) && !scope.managedDepartmentNames.includes(departmentName)) {
    return false;
  }
  const owner = resolveBranchYearOwner(departments, departmentName, year, catalogId);
  return scope.ownDepartmentNames.includes(owner) || scope.childDepartmentNames.includes(owner);
}

/**
 * Stricter sibling of `canHodEditDepartmentYear`, for Sections ONLY (its own
 * GET accessLevel tagging and PATCH/DELETE gate - see api/college/sections).
 * `canHodEditDepartmentYear`'s `childDepartmentNames` clause deliberately lets
 * a true sub-department's own HOD keep editing it every year regardless of
 * who else manages a given year - Teaching Assignments and the Students
 * routes rely on that and must keep it. Sections wants the opposite for a
 * branch that is BOTH a true child of one department AND grouped under a
 * DIFFERENT department's `managedDepartments` for the shared first year (e.g.
 * "data science"/"machine learning" are true children of "Artificial
 * Intelligence" but grouped under "BASIC SCIENCE ENGLISH" for Year 1): the
 * shared-year manager should be the ONLY one who can edit/delete that year's
 * sections, with the branch's own permanent HOD getting view-only there and
 * full ownership resuming from the year they actually start running their own
 * sections. Same signature and department-membership guard as
 * `canHodEditDepartmentYear`; only the unconditional `childDepartmentNames`
 * early-return is dropped, so `resolveBranchYearOwner` decides every case
 * (own, child, and managed alike) uniformly instead of skipping it for a true
 * child.
 */
export function canHodExclusivelyOwnDepartmentYear<T extends DepartmentYearRow & { name?: string }>(
  scope: { ownDepartmentNames: string[]; childDepartmentNames: string[]; managedDepartmentNames: string[] },
  departments: T[],
  departmentName: string,
  year: number,
  catalogId?: string
): boolean {
  if (!departmentName || scope.ownDepartmentNames.length === 0) return false;
  if (
    !scope.ownDepartmentNames.includes(departmentName) &&
    !scope.childDepartmentNames.includes(departmentName) &&
    !scope.managedDepartmentNames.includes(departmentName)
  ) {
    return false;
  }
  const owner = resolveBranchYearOwner(departments, departmentName, year, catalogId);
  return scope.ownDepartmentNames.includes(owner) || scope.childDepartmentNames.includes(owner);
}
