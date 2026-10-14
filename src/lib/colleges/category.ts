import type { CollegeCategory } from "@/types";

// Main / Test college category. Colleges are split into two groups: Main colleges see other Main colleges, Test colleges
// see other Test colleges, wherever a college user is offered "another college" (e.g. a publication author's affiliation).
//
// Stored as `collegeCategory` on the college document. A college without the field - every college that existed before
// this was introduced - is MAIN, so nothing changes for the real colleges until a Super Admin marks a college as Test.

export const COLLEGE_CATEGORIES: CollegeCategory[] = ["MAIN", "TEST"];

/** The stored value when it is a known category, otherwise null. */
export function parseCollegeCategory(raw: unknown): CollegeCategory | null {
  return raw === "MAIN" || raw === "TEST" ? raw : null;
}

/** A college document's category: its own value, or MAIN when it has none (or an unknown one). */
export function collegeCategoryOf(college: { collegeCategory?: unknown } | null | undefined): CollegeCategory {
  return parseCollegeCategory(college?.collegeCategory) ?? "MAIN";
}

export function isSameCategory(a: { collegeCategory?: unknown } | null | undefined, b: { collegeCategory?: unknown } | null | undefined): boolean {
  return collegeCategoryOf(a) === collegeCategoryOf(b);
}
