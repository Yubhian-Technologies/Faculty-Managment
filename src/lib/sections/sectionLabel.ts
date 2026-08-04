import type { Department } from "@/types";

// Sections are cross-listed to at most one secondary department (Office picks
// exactly one of the department's configured secondary departments at
// creation — see college/sections POST), so `secondaryDepartments` is always
// 0 or 1 entries long for any given section, never more.
export function departmentCode(name: string, departments: Department[]): string {
  return departments.find((d) => d.name === name)?.code || name;
}

// e.g. "BS A" for a plain section, "BS CSE A" for one cross-listed to CSE —
// the primary and secondary department codes read together with the section
// letter, so which branch a shared/first-year section feeds into is visible
// at a glance wherever sections are listed.
export function sectionDisplayLabel(
  section: { department?: string; secondaryDepartments?: string[]; name: string },
  departments: Department[]
): string {
  const primary = section.department ? departmentCode(section.department, departments) : "";
  const secondary = section.secondaryDepartments?.[0];
  const secondaryCode = secondary ? departmentCode(secondary, departments) : "";
  return [primary, secondaryCode, section.name].filter(Boolean).join(" ");
}
