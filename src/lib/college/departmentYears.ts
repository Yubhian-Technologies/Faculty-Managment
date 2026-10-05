import { managerEffectiveYears } from "@/lib/departments/hodScope";
import type { Department } from "@/types";

/**
 * What a YEAR picker should offer for a department.
 *
 * The rule itself is managerEffectiveYears (lib/departments/hodScope.ts) - the
 * department's own years for this course, else its parent's for a
 * sub-department that carries none, minus any year it FEEDS to another
 * department. This module deliberately does not restate that: it is the same
 * rule the server scopes by, and a second copy would drift.
 *
 * What is added here is only the UI policy around it:
 *
 *  - Fall back to the years the department's sections are actually in when
 *    nothing is configured. 58 of 105 departments across the live colleges
 *    have no assigned years at all, and an empty picker is worse than an
 *    inferred one. The fallback cannot know about a year the department
 *    teaches but has no section for yet - that is the cost of leaving a
 *    department unconfigured, not a reason to widen the rule.
 *
 *  - Union across several departments, for an HOD who heads more than one.
 *
 * Pickers used to derive their years from sections alone, which says something
 * subtly different: a department assigned years 2-4 still offered year 1 if one
 * shared first-year section was filed under it, and a department assigned a
 * year it had not created sections for yet offered nothing.
 */
export function offeredYears(
  department: Department | undefined,
  allDepartments: Department[],
  catalogId: string | undefined,
  fallbackYears: number[]
): number[] {
  const assigned = department ? clean(managerEffectiveYears(department, allDepartments, catalogId)) : [];
  return assigned.length > 0 ? assigned : clean(fallbackYears);
}

/**
 * The union of several departments' offered years - for an HOD who heads more
 * than one.
 *
 * Pass the HOD's OWN department names, never the departments their sections
 * belong to. A managing department runs branches whose sections are filed under
 * the BRANCH (Basic Science teaches the shared first year of data science, ECE
 * and the rest, and those sections say "data science"), so reading names off
 * sections yields the branches' years - 2-4 - and drops the one year the
 * manager actually runs.
 */
export function offeredYearsAcross(
  departmentNames: string[],
  allDepartments: Department[],
  catalogId: string | undefined,
  fallbackYears: number[]
): number[] {
  const named = departmentNames
    .map((name) => allDepartments.find((d) => d.name === name))
    .filter((d): d is Department => !!d);
  if (named.length === 0) return clean(fallbackYears);

  const all = named.flatMap((d) => managerEffectiveYears(d, allDepartments, catalogId));
  const assigned = clean(all);
  return assigned.length > 0 ? assigned : clean(fallbackYears);
}

function clean(years: number[]): number[] {
  return Array.from(new Set(years.filter((y) => Number.isFinite(y) && y >= 1))).sort((a, b) => a - b);
}
