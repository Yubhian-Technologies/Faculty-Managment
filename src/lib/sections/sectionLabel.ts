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
// the composed form as their name, e.g. "BS-CSE-A". Prefixing those again would
// read "BS CSE BS-CSE-A", so they are returned as-is. Older sections, which
// store just the letter, are still composed here - both shapes coexist and
// render the same way.
export function sectionDisplayLabel(
  section: { department?: string; secondaryDepartments?: string[]; name: string },
  departments: Department[]
): string {
  const primary = section.department ? departmentCode(section.department, departments) : "";
  const secondary = section.secondaryDepartments?.[0];
  const secondaryCode = secondary ? departmentCode(secondary, departments) : "";

  if (secondaryCode && nameAlreadyCarries(section.name, secondaryCode)) {
    return section.name;
  }
  return [primary, secondaryCode, section.name].filter(Boolean).join(" ");
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
