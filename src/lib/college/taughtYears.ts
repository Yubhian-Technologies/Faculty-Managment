// "Years Taught" - which ordinal years (1..duration) a department teaches a course.
//
// An EMPTY list never means "teaches everything". Before this module, every server check
// read `assignedYears.length > 0 && !assignedYears.includes(year)` - so a department with
// nothing configured (never set, cleared, or only a parent that has none) silently accepted
// ANY year, and clearing a course's scope switched validation off for it. Now an empty result
// is its own explicit state ("none" = NOT CONFIGURED) and a year is admitted only when it is
// actually one the department teaches (own years, a parent's it inherits, or - for a branch
// reached through its shared-year manager - the manager's).
//
// Pure (no Firestore, no Next) so the same answer is used by the API routes, the dependency
// check (yearDependents.ts) and the client pickers.

import type { DepartmentCourseScope } from "@/types";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import { findBranchManager, type DepartmentYearRow } from "@/lib/departments/managedBranches";

export type YearsDepartment = DepartmentYearRow & {
  name?: string;
  secondaryDepartments?: string[];
  courseScopes?: Record<string, DepartmentCourseScope>;
};

/**
 * "own"       - the department's own per-course override, or its flat fallback
 * "inherited" - it has none of its own, so its parent's apply (HOD-created sub-departments)
 * "none"      - NOT CONFIGURED: it teaches no year for this course
 */
export type TaughtYearsStatus = "own" | "inherited" | "none";

export interface TaughtYears {
  status: TaughtYearsStatus;
  years: number[];
}

export function resolveTaughtYears(
  department: YearsDepartment,
  allDepartments: YearsDepartment[],
  catalogId: string | undefined | null
): TaughtYears {
  const own = resolveDepartmentCourseScope(department, catalogId).assignedYears;
  if (own.length > 0) return { status: "own", years: own };
  if (department.parentDepartmentId) {
    const parent = allDepartments.find((d) => d.id === department.parentDepartmentId);
    if (parent) {
      const inherited = resolveDepartmentCourseScope(parent, catalogId).assignedYears;
      if (inherited.length > 0) return { status: "inherited", years: inherited };
    }
  }
  return { status: "none", years: [] };
}

export type YearAdmission =
  | { ok: true; via: "own" | "inherited" | "manager" }
  | { ok: false; reason: "NOT_CONFIGURED" | "NOT_TAUGHT" };

/**
 * Whether `department` may hold (a section / student / assignment / ...) at `year` for `catalogId`.
 *
 * `viaManagedBranch` - the caller reached this branch through a shared-year manager's grouping
 * (Department.managedDepartments), so a year the MANAGER teaches is also admitted even though
 * the branch's own Years Taught never lists it (the VIT shape: a branch's own years are [2,3,4],
 * its Year-1 sections are run by the Basic Science manager). Off for a branch's own dedicated HOD.
 */
export function admitYear(args: {
  department: YearsDepartment;
  allDepartments: YearsDepartment[];
  catalogId: string | undefined | null;
  year: number;
  viaManagedBranch?: boolean;
}): YearAdmission {
  const { department, allDepartments, catalogId, year, viaManagedBranch } = args;
  const taught = resolveTaughtYears(department, allDepartments, catalogId);
  if (taught.years.includes(year)) return { ok: true, via: taught.status === "inherited" ? "inherited" : "own" };
  if (viaManagedBranch && department.name) {
    const manager = findBranchManager(allDepartments, department.name, catalogId ?? undefined);
    if (manager?.years.includes(year)) return { ok: true, via: "manager" };
  }
  return { ok: false, reason: taught.status === "none" ? "NOT_CONFIGURED" : "NOT_TAUGHT" };
}

/** The message for a department with no Years Taught for the course - same wording everywhere. */
export function notConfiguredMessage(departmentName: string | undefined, year: number | string, courseName?: string): string {
  const who = departmentName ? `"${departmentName}"` : "This department";
  const what = courseName ? ` for ${courseName}` : "";
  return `${who} has no Years Taught set${what}, so Year ${year} can't be used yet. Ask the Principal to set its Years Taught first.`;
}
