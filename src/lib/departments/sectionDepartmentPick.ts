import type { Department } from "@/types";
import { sectionMatchesDepartmentFilter } from "@/lib/departments/hodScope";
import {
  childrenOfDepartment,
  coreDepartmentOptions,
  isContainerDepartment,
  rollupDepartmentNamesForPick,
  type TreeDepartment,
} from "@/lib/departments/departmentTree";

/**
 * The Department / Core department filters of a college-wide SECTIONS view
 * (the Principal's Sections tab, Internal Marks): what a pick stands for, from
 * the department configuration alone.
 *
 * A section is filed under its real branch for every year, so the old rule
 * (`sectionMatchesDepartmentFilter`) decides by who RUNS that section's year -
 * Basic Science runs year 1 of the branches it manages and nothing else. That
 * rule stays exactly as it is and still decides first. ADDED to it: a parent
 * that holds nothing itself (a container - AI, split into two branches that
 * hold the real sections) stands for its sub-departments' own sections, all
 * years, because those are its own branches rather than a shared year it
 * teaches. Nothing the old rule matched can drop out.
 */

type SectionLike = { department: string; year: number };

export function sectionMatchesPick<D extends Department>(
  all: D[],
  pickedName: string,
  section: SectionLike,
  catalogId: string | undefined,
  /** Where the loaded sections are filed - how a parent is recognised as holding nothing. */
  sectionDepartmentNames: Iterable<string>
): boolean {
  if (sectionMatchesDepartmentFilter(all, pickedName, section.department, section.year, catalogId)) return true;
  const have = Array.from(sectionDepartmentNames, (n) => (n ?? "").trim()).filter(Boolean);
  const rolled = rollupDepartmentNamesForPick(all, pickedName, have.length > 0 ? have : null);
  return rolled.includes((section.department ?? "").trim());
}

/**
 * The Core department options for a pick, those that have sections in what is
 * loaded: the branches the pick (or, for a parent, its sub-departments) manages,
 * and - for a container - its own sub-departments, which are its branches.
 * A parent that runs its own sections keeps none of its sub-departments here:
 * they are listed beneath it in the Department dropdown instead.
 */
export function sectionCoreOptions<D extends TreeDepartment>(
  all: D[],
  pickedName: string,
  sectionDepartmentNames: Iterable<string>
): string[] {
  const picked = (pickedName ?? "").trim();
  if (!picked) return [];
  const have = new Set(Array.from(sectionDepartmentNames, (n) => (n ?? "").trim()).filter(Boolean));
  const out = new Set(coreDepartmentOptions(all, [picked], have));
  const dept = all.find((d) => (d.name ?? "").trim() === picked);
  if (dept && isContainerDepartment(dept, all, have.size > 0 ? have.has(picked) : undefined)) {
    for (const c of childrenOfDepartment(all, dept)) {
      const n = (c.name ?? "").trim();
      if (n && have.has(n)) out.add(n);
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * Whether a section is of the picked Core department: filed under it, or - for a
 * managed branch that holds no sections itself - under one of its sub-branches.
 * Only ever applied AFTER the Department pick, so a manager's year rule still holds.
 */
export function sectionIsOfCore<D extends TreeDepartment>(all: D[], coreName: string, sectionDepartment: string): boolean {
  const core = (coreName ?? "").trim();
  const dept = (sectionDepartment ?? "").trim();
  if (!core || !dept) return false;
  if (dept === core) return true;
  const coreDoc = all.find((d) => (d.name ?? "").trim() === core);
  return !!coreDoc && childrenOfDepartment(all, coreDoc).some((c) => (c.name ?? "").trim() === dept);
}
