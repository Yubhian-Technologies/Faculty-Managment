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

  const parts: string[] = [];
  if (primary && !nameAlreadyCarries(section.name, primary)) parts.push(primary);
  if (secondaryCode && !nameAlreadyCarries(section.name, secondaryCode)) parts.push(secondaryCode);
  parts.push(section.name);
  return parts.filter(Boolean).join(" ");
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
