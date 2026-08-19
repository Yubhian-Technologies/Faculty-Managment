import type { Department } from "@/types";

// Department names are stored as free-text copies in many places (Section.
// department/secondaryDepartments, other departments' own secondaryDepartments/
// managedDepartments/courseScopes, Student.department/secondaryDepartment) -
// renaming a department (college/departments PATCH) does not cascade the new
// name into any of them. `college/departments` already enforces name
// uniqueness case-insensitively (two departments can never differ only by
// case), so a case/whitespace-insensitive comparison here can never conflate
// two different real departments - it only protects against exactly this
// staleness (e.g. a department created as "ARTIFICIAL INTELLIGENCE AND
// MACHINE LEARNING" and later renamed to "Artificial Intelligence and
// Machine Learning", whose old sections/cross-listing entries still say the
// former). Every name-equality check in this file goes through this.
function normalizeDeptName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

// A shared-first-year student's real branch section can exist in one of two
// structurally different shapes - and every place that resolves "which
// section(s) belong to this student's branch" (Students page's Distribute/
// Assign dialogs, the per-department and whole-cohort distribute API routes)
// needs to recognize BOTH, or a college using the second shape silently shows
// "no sections" even though they exist:
//
//   1. Managed branch (Department.managedDepartments): the branch (e.g. IT)
//      is a real top-level department and owns its own Section docs directly
//      - section.department === "IT".
//   2. Legacy cross-listed (Department.secondaryDepartments, hod/sections/
//      new's branch-picker "Secondary Department" mode): the COMMON
//      department (e.g. "Maths") owns the Section doc itself, cross-listed to
//      the branch - section.department === "Maths", with "IT" only appearing
//      in section.secondaryDepartments.
//
// `ownerDepartment` is the student's own (primary) department - "Maths" in
// the example above, whichever shape applies. `branch` is their
// secondaryDepartment (the real branch they're headed to), or "" for a plain
// department with no shared-year split at all, in which case this is just a
// same-department check.
export function sectionFeedsTarget(
  section: { department?: string; secondaryDepartments?: string[] },
  ownerDepartment: string,
  branch: string
): boolean {
  const sectionDept = normalizeDeptName(section.department);
  const owner = normalizeDeptName(ownerDepartment);
  const b = normalizeDeptName(branch);
  if (!b) return sectionDept === owner;
  if (sectionDept === b) return true;
  return sectionDept === owner && (section.secondaryDepartments ?? []).some((d) => normalizeDeptName(d) === b);
}

/**
 * Groups sections by every branch they "belong to" for placement purposes -
 * their own department, AND each department they cross-list to (see
 * sectionFeedsTarget's doc-comment for why both matter). A section owned by
 * "Maths" and cross-listed to both "AIDS" and "AIML" appears under all three
 * keys. Used by distribute-cohort (one whole shared year, bucketed by every
 * branch its unassigned students are headed to) so a legacy cross-listed
 * section is found the same as a managed-branch one.
 */
export function groupSectionsByBranch<T extends { department?: string; secondaryDepartments?: string[] }>(
  sections: T[]
): Map<string, T[]> {
  // Keyed by normalizeDeptName, not the raw string - a stale-cased reference
  // still groups under the same key as its real branch (see this file's top
  // comment). Always look up through sectionsForBranch below rather than
  // `.get()` directly, so the lookup side normalizes the same way.
  const map = new Map<string, T[]>();
  const add = (key: string | undefined, s: T) => {
    const raw = key?.trim();
    if (!raw) return;
    const k = normalizeDeptName(raw);
    const list = map.get(k);
    if (list) list.push(s); else map.set(k, [s]);
  };
  for (const s of sections) {
    add(s.department, s);
    for (const secondary of s.secondaryDepartments ?? []) add(secondary, s);
  }
  return map;
}

/** Case/whitespace-insensitive lookup into groupSectionsByBranch's result. */
export function sectionsForBranch<T>(map: Map<string, T[]>, branch: string): T[] {
  return map.get(normalizeDeptName(branch)) ?? [];
}

// Sections are cross-listed to at most one secondary department (Office picks
// exactly one of the department's configured secondary departments at
// creation - see college/sections POST), so `secondaryDepartments` is always
// 0 or 1 entries long for any given section, never more.
export function departmentCode(name: string, departments: Department[]): string {
  const target = normalizeDeptName(name);
  return departments.find((d) => normalizeDeptName(d.name) === target)?.code || name;
}

// e.g. "BS A" for a plain section, "BS CSE A" for one cross-listed to CSE -
// the primary and secondary department codes read together with the section
// letter, so which branch a shared/first-year section feeds into is visible
// at a glance wherever sections are listed.
//
// Sections created through the branch picker (hod/sections/new) already store
// the composed form as their name, e.g. "BS-CSE-A" or "BSE-CIVIL-A". A code the
// name already carries is dropped from the prefix rather than repeated, so
// those read "BSE-CIVIL-A" and not "CIVIL BSE-CIVIL-A". Older sections, which
// store just the letter, are still composed here - both shapes coexist and
// render the same way.
//
// Each code is tested on its own, because which one repeats depends on how the
// section was created: a managed-branch section is owned BY the branch, so it's
// the primary code (CIVIL) that its name already contains, while a cross-listed
// one is owned by the common department and repeats the secondary instead.
export function sectionDisplayLabel(
  section: { department?: string; secondaryDepartments?: string[]; name: string },
  departments: Department[]
): string {
  const primary = section.department ? departmentCode(section.department, departments) : "";
  const secondary = section.secondaryDepartments?.[0];
  const secondaryCode = secondary ? departmentCode(secondary, departments) : "";

  // Both codes are checked - a plain section named through the branch picker
  // carries its own department's code ("BS-A" for Basic Science), so prefixing
  // `primary` again would read "BS BS-A", exactly as a cross-listed one would
  // repeat the secondary.
  //
  // Each is dropped on its own rather than returning the bare name as soon as
  // either matches: a cross-listed section whose name carries the primary but
  // not the secondary still needs the secondary shown, or the branch it feeds
  // disappears from the label. The two approaches agree on every section shape
  // currently in the data; this one just doesn't lose that case.
  const parts: string[] = [];
  if (primary && !nameAlreadyCarries(section.name, primary)) parts.push(primary);
  if (secondaryCode && !nameAlreadyCarries(section.name, secondaryCode)) parts.push(secondaryCode);
  parts.push(section.name);
  return parts.filter(Boolean).join(" ");
}

/**
 * Labels a list of sections for one dropdown/checkbox group, appending each
 * section's course name ONLY where two sections in the list would otherwise
 * render an identical label - e.g. a "IT-A" running under both B.Tech and
 * M.Tech. Lists already scoped to a single course (the common case) come back
 * unchanged; only a picker that spans several courses at once (like the
 * Students page's "Distribute Unassigned" dialog, which lists a department's
 * sections across every course) needs the disambiguation.
 */
export function disambiguateSectionLabels<
  T extends { id: string; department?: string; secondaryDepartments?: string[]; name: string; courseName?: string }
>(sections: T[], departments: Department[]): Map<string, string> {
  const base = new Map(sections.map((s) => [s.id, sectionDisplayLabel(s, departments)]));
  const counts = new Map<string, number>();
  for (const label of base.values()) counts.set(label, (counts.get(label) ?? 0) + 1);

  const out = new Map<string, string>();
  for (const s of sections) {
    const label = base.get(s.id) ?? s.name;
    out.set(s.id, (counts.get(label) ?? 0) > 1 && s.courseName ? `${label} (${s.courseName})` : label);
  }
  return out;
}

/**
 * True when the stored name already contains the branch code as its own
 * segment - "BS-CSE-A" carries "CSE", while a plain letter or a section
 * coincidentally named "CSELAB" does not.
 */
function nameAlreadyCarries(name: string, code: string): boolean {
  const target = code.trim().toUpperCase();
  if (!target) return false;
  return name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .some((segment) => segment === target);
}
