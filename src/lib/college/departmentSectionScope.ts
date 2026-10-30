import type { Department } from "@/types";

/**
 * Which departments are worth offering in a filter, and what their "core"
 * departments are.
 *
 * A filter that lists every configured department offers choices that can only
 * return nothing. At one live college "Basic Science" has no sections and no
 * students at all - its four sub-departments do the real work - so picking it
 * was always a dead end.
 *
 * "Has sections" deliberately means sections it RESOLVES to, not only sections
 * filed under its own name. A shared-first-year department owns none: Basic
 * Science - Chemistry manages Computer Science and Engineering and Computer
 * Science and Business System, and the sections it teaches are filed under
 * those branches. Judging it on its own name alone would have hidden exactly
 * the departments the Office needs.
 */

const namesOf = (names: Iterable<string>) =>
  new Set([...names].map((n) => n.trim()).filter(Boolean));

/** The departments a department manages that themselves hold sections. */
type DepartmentRef = Pick<Department, "name"> & Partial<Pick<Department, "hasSubDepartments" | "managedDepartments">>;

/** A department reference carrying enough of the hierarchy to resolve one level of children. */
type DepartmentWithHierarchy = Pick<Department, "name"> & Partial<Pick<Department, "id" | "parentDepartmentId">>;

/**
 * True when `name` has sections filed directly under it, OR - when `name` is
 * itself a container split into sub-departments (e.g. a managed branch like
 * ARTIFICIAL INTELLIGENCE that holds nothing of its own because it's split
 * into CSE [AI & DATA SCIENCE] / CSE [AI & MACHINE LEARNING]) - under one of
 * ITS children. Without this, a department that manages such a branch (e.g.
 * BASIC SCIENCE - MATHS managing ARTIFICIAL INTELLIGENCE) was judged to have
 * no sections at all and dropped from filters, even though its branch's
 * sections plainly exist, just one hierarchy level deeper.
 */
function managedNameHasSections(name: string, have: Set<string>, all: DepartmentWithHierarchy[]): boolean {
  if (have.has(name)) return true;
  const dept = all.find((d) => (d.name ?? "").trim() === name);
  if (!dept?.id) return false;
  return all.some((d) => d.parentDepartmentId === dept.id && have.has((d.name ?? "").trim()));
}

export function coreDepartmentsWithSections(
  department: DepartmentRef | undefined,
  sectionDepartmentNames: Iterable<string>,
  all: DepartmentWithHierarchy[] = []
): string[] {
  if (!department) return [];
  const have = namesOf(sectionDepartmentNames);
  return Array.from(
    new Set((department.managedDepartments ?? []).map((n) => (n ?? "").trim()).filter(Boolean))
  )
    .filter((n) => managedNameHasSections(n, have, all))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * True when this department resolves to at least one section.
 *
 * A department with sub-departments and none of its own is treated as a
 * container and left out: its children are listed separately and are the ones
 * that actually manage the branches, so offering the parent as well is both
 * redundant and, where nothing is filed under it, empty. A parent that does
 * run its own sections still qualifies on that basis.
 */
export function departmentHasSections(
  department: DepartmentRef,
  sectionDepartmentNames: Iterable<string>,
  all: DepartmentWithHierarchy[] = []
): boolean {
  const have = namesOf(sectionDepartmentNames);
  if (have.has((department.name ?? "").trim())) return true;
  if (department.hasSubDepartments) return false;
  return coreDepartmentsWithSections(department, have, all).length > 0;
}

/**
 * The active departments that resolve to sections, in the given order.
 *
 * Falls back to every active department when that would leave NOTHING to pick.
 * Six live colleges (the dental, pharmacy and degree colleges, and BVRIT-W)
 * have departments but not one section yet, and narrowing a picker to nothing
 * would take their Students filter away entirely rather than tidy it up. There
 * is nothing to narrow to at such a college, so the old full list is the honest
 * answer until sections exist.
 */
export function departmentsWithSections(
  departments: Department[],
  sectionDepartmentNames: Iterable<string>
): Department[] {
  const have = namesOf(sectionDepartmentNames);
  const active = departments.filter((d) => d.isActive !== false);
  const withSections = active.filter((d) => departmentHasSections(d, have, departments));
  return withSections.length > 0 ? withSections : active;
}
