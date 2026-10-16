import {
  childrenOfDepartment,
  departmentFilterOptions,
  isContainerDepartment,
  managedCoreCandidates,
  type TreeDepartment,
} from "@/lib/departments/departmentTree";

/**
 * ONE Department filter for every list: each department, its sub-departments
 * listed under it, and - under the department that groups them - the core
 * branches it holds a shared year for. Replaces the separate "Sub-department"
 * and "Core department" fields; nothing else about what a pick means changes.
 *
 * A pick is just a (department, coreDepartment) pair, exactly what the list
 * APIs already take (`department=` and `coreDepartment=`), so the server side is
 * untouched. The pair travels through a Select as one string (`value`).
 *
 * Structural: it reads only the department configuration (and, optionally, the
 * names sections are filed under, to tell which parents hold nothing), never
 * rows, so an option never appears or vanishes as data loads.
 */

export const DEPARTMENT_PICK_ALL = "all";
const SEP = "\u001f";

export interface DepartmentPickOption {
  /** The Select value: "department" or "department<SEP>core". */
  value: string;
  label: string;
  /** 0 = top level, 1 = sub-department or core branch of a top-level one, 2 = core branch of a sub-department. */
  depth: 0 | 1 | 2;
  department: string;
  coreDepartment: string;
  /** Picking it means "all of its sub-departments" (it holds nothing itself). */
  container: boolean;
}

export function departmentPickValue(department: string, coreDepartment = ""): string {
  const d = department.trim();
  if (!d) return DEPARTMENT_PICK_ALL;
  const c = coreDepartment.trim();
  return c ? `${d}${SEP}${c}` : d;
}

export function parseDepartmentPick(value: string): { department: string; coreDepartment: string } {
  if (!value || value === DEPARTMENT_PICK_ALL) return { department: "", coreDepartment: "" };
  const i = value.indexOf(SEP);
  return i < 0
    ? { department: value, coreDepartment: "" }
    : { department: value.slice(0, i), coreDepartment: value.slice(i + 1) };
}

/** True when `value` is still one of `options` (or "all") - how a cascade drops a stale pick. */
export function isDepartmentPickOffered(options: DepartmentPickOption[], value: string): boolean {
  return value === DEPARTMENT_PICK_ALL || options.some((o) => o.value === value);
}

const clean = (n: string | null | undefined) => (n ?? "").trim();

/**
 * @param candidates departments the viewer may pick among (already narrowed by Course, etc.)
 * @param all every department of the college (the hierarchy is read from these)
 * @param sectionDepartmentNames names sections are filed under; empty = only the explicit "holds nothing" flag is trusted
 * @param withCore false = leave the core branches out (a list that has no Core filter)
 */
export function buildDepartmentPickOptions<T extends TreeDepartment>(
  candidates: T[],
  all: T[],
  sectionDepartmentNames: Iterable<string> = [],
  withCore = true
): DepartmentPickOption[] {
  const have = new Set(Array.from(sectionDepartmentNames, clean).filter(Boolean));
  const out: DepartmentPickOption[] = [];
  for (const o of departmentFilterOptions(candidates, all, have)) {
    const name = clean(o.department.name);
    const depth = o.depth;
    out.push({
      value: departmentPickValue(name), label: name, depth, department: name, coreDepartment: "", container: o.container,
    });
    if (!withCore) continue;
    // Only what THIS department itself groups: its sub-departments are listed on
    // their own, with their own core branches beneath them.
    for (const core of managedCoreCandidates(all, o.department, false)) {
      if (core === name) continue;
      const branch = all.find((d) => clean(d.name) === core);
      // A container is left out - its own sub-branches stand in its place.
      if (branch && isContainerDepartment(branch, all, have.has(core) || undefined)) continue;
      out.push({
        value: departmentPickValue(name, core), label: core, depth: (depth + 1) as 1 | 2, department: name, coreDepartment: core, container: false,
      });
    }
  }
  return out;
}

/** The sub-departments of a department, as picks (used by callers that need to expand "all of it"). */
export function subDepartmentNames<T extends TreeDepartment>(all: T[], departmentName: string): string[] {
  const dept = all.find((d) => clean(d.name) === clean(departmentName));
  return dept ? childrenOfDepartment(all, dept).map((c) => clean(c.name)).filter(Boolean) : [];
}
