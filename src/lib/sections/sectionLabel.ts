import type { Department } from "@/types";

// Sections are cross-listed to at most one secondary department (Office picks
// exactly one of the department's configured secondary departments at
// creation - see college/sections POST), so `secondaryDepartments` is always
// 0 or 1 entries long for any given section, never more.
export function departmentCode(name: string, departments: Department[]): string {
  return departments.find((d) => d.name === name)?.code || name;
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
