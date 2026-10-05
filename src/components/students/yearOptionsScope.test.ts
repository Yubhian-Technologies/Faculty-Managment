import { describe, expect, it } from "vitest";

// The Year picker must only offer years the chosen department really teaches
// for the chosen course. yearOptionsForDepartment used to answer "every college
// year" whenever its resolution came back empty - which is what showed 1st-4th
// year for a Basic Science sub-department. These tests pin the new behaviour AND
// prove a department that resolves to any years is untouched (compared against
// a frozen copy of the old function).

import { yearOptionsForDepartment } from "@/components/students/RosterFieldInputs";
import { managerEffectiveYears } from "@/lib/departments/hodScope";
import { resolveCatalogId } from "@/lib/college/academicStructure";
import type { Course, Department } from "@/types";

/** The function exactly as it was before the change - the reference for "unchanged". */
function legacyYearOptionsForDepartment(
  departments: Department[], courses: Course[], departmentName: string, courseName: string, fallbackYears: number[]
): number[] {
  const dept = departments.find((d) => d.name === departmentName);
  if (!dept) return fallbackYears;
  if (courseName) {
    const catalogId = resolveCatalogId(courses, dept.id, courseName);
    const assigned = managerEffectiveYears(dept, departments, catalogId);
    return assigned.length > 0 ? [...assigned].sort((a, b) => a - b) : fallbackYears;
  }
  const effectiveId = dept.parentDepartmentId ?? dept.id;
  const catalogIds = Array.from(new Set(
    courses.filter((c) => c.departmentId === effectiveId).map((c) => c.catalogId).filter((c): c is string => !!c)
  ));
  if (catalogIds.length === 0) {
    const assigned = managerEffectiveYears(dept, departments, undefined);
    return assigned.length > 0 ? [...assigned].sort((a, b) => a - b) : fallbackYears;
  }
  const union = new Set<number>();
  for (const catalogId of catalogIds) {
    for (const y of managerEffectiveYears(dept, departments, catalogId)) union.add(y);
  }
  return union.size > 0 ? Array.from(union).sort((a, b) => a - b) : fallbackYears;
}

const BT = "cat-btech"; // 4-year
const MT = "cat-mtech"; // 2-year
const dept = (o: Record<string, unknown>) => ({ isActive: true, ...o }) as unknown as Department;
const course = (id: string, name: string, departmentId: string, catalogId: string, durationYears: number) =>
  ({ id, name, departmentId, catalogId, durationYears }) as unknown as Course;
const FALLBACK = [1, 2, 3, 4];
const opts = (d: Department[], c: Course[], dept: string, course: string) => yearOptionsForDepartment(d, c, dept, course, FALLBACK);
const legacy = (d: Department[], c: Course[], dept: string, course: string) => legacyYearOptionsForDepartment(d, c, dept, course, FALLBACK);

// ── A Vishnu-shaped college: "Basic Science" parent with sub-departments that own
//    no Course docs, each managing real branches. Everything is configured. ──────
const vitDepts: Department[] = [
  dept({ id: "bs", name: "Basic Science", hasSubDepartments: true, parentRunsOwnSections: true,
    courseScopes: { [BT]: { assignedYears: [1], secondaryDepartments: ["CSE", "IT", "ECE"] } } }),
  dept({ id: "bs-eng", name: "Basic Science - English", parentDepartmentId: "bs", managedDepartments: ["ECE"] }),
  dept({ id: "bs-chem", name: "Basic Science - Chemistry", parentDepartmentId: "bs", managedDepartments: ["CSE"] }),
  dept({ id: "cse", name: "CSE", courseScopes: { [BT]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } }),
  dept({ id: "it", name: "IT", courseScopes: { [BT]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } }),
  dept({ id: "ece", name: "ECE", courseScopes: { [BT]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } }),
];
const vitCourses: Course[] = [
  course("c-bs", "B.Tech", "bs", BT, 4), course("c-cse", "B.Tech", "cse", BT, 4),
  course("c-it", "B.Tech", "it", BT, 4), course("c-ece", "B.Tech", "ece", BT, 4),
];

describe("a fully configured college is unchanged", () => {
  it("every (department, course) answers exactly what the old function did, and Basic Science teaches only year 1", () => {
    for (const d of vitDepts) {
      for (const courseName of ["B.Tech", ""]) {
        expect(opts(vitDepts, vitCourses, d.name, courseName), `${d.name} / "${courseName}"`).toEqual(legacy(vitDepts, vitCourses, d.name, courseName));
      }
    }
    expect(opts(vitDepts, vitCourses, "Basic Science - English", "B.Tech")).toEqual([1]);
    expect(opts(vitDepts, vitCourses, "Basic Science", "B.Tech")).toEqual([1]);
    expect(opts(vitDepts, vitCourses, "CSE", "B.Tech")).toEqual([2, 3, 4]);
  });

  it("an unknown department still gets the caller's fallback untouched", () => {
    expect(opts(vitDepts, vitCourses, "No Such Dept", "B.Tech")).toBe(FALLBACK);
    expect(opts(vitDepts, vitCourses, "No Such Dept", "")).toBe(FALLBACK);
  });
});

// ── The defect: a stray freshman-style department lists the Basic Science
//    sub-departments as its Core Departments, so their year 1 is "fed away". ────
const strayDepts: Department[] = [
  ...vitDepts.filter((d) => d.id !== "cse"),
  dept({ id: "cse", name: "CSE", courseScopes: { [BT]: { assignedYears: [2, 3, 4], secondaryDepartments: [] }, [MT]: { assignedYears: [1, 2], secondaryDepartments: [] } } }),
  dept({ id: "stray", name: "StrayBS", hasSubDepartments: false, courseScopes: {
    [BT]: { assignedYears: [1], secondaryDepartments: ["Basic Science - English", "Basic Science - Chemistry", "CSE"] },
    [MT]: { assignedYears: [1, 2], secondaryDepartments: ["Basic Science - English", "CSE"] },
  } }),
];
const strayCourses: Course[] = [
  ...vitCourses, course("c-cse-m", "M.Tech", "cse", MT, 2), course("c-stray", "B.Tech", "stray", BT, 4), course("c-stray-m", "M.Tech", "stray", MT, 2),
];

describe("a department whose years resolve to nothing", () => {
  it("the old function offered every year (the reported bug) - that is what these rows reproduce", () => {
    expect(managerEffectiveYears(strayDepts.find((d) => d.id === "bs-eng")!, strayDepts, BT)).toEqual([]);
    expect(legacy(strayDepts, strayCourses, "Basic Science - English", "B.Tech")).toEqual([1, 2, 3, 4]);
  });

  it("a shared-first-year sub-department now offers only its shared year", () => {
    expect(opts(strayDepts, strayCourses, "Basic Science - English", "B.Tech")).toEqual([1]);
    expect(opts(strayDepts, strayCourses, "Basic Science - Chemistry", "B.Tech")).toEqual([1]);
  });

  it("the same holds in filter bars, where no course is chosen yet", () => {
    expect(opts(strayDepts, strayCourses, "Basic Science - English", "")).toEqual([1]);
  });

  it("a branch whose every configured year is fed away is capped to the course's own length (2-year M.Tech)", () => {
    expect(managerEffectiveYears(strayDepts.find((d) => d.id === "cse")!, strayDepts, MT)).toEqual([]);
    expect(legacy(strayDepts, strayCourses, "CSE", "M.Tech")).toEqual([1, 2, 3, 4]);
    expect(opts(strayDepts, strayCourses, "CSE", "M.Tech")).toEqual([1, 2]);
  });

  it("changes nothing for any (department, course) that DID resolve to years", () => {
    for (const d of strayDepts) {
      for (const courseName of ["B.Tech", "M.Tech"]) {
        const cat = resolveCatalogId(strayCourses, d.id, courseName);
        if (managerEffectiveYears(d, strayDepts, cat).length === 0) continue;
        expect(opts(strayDepts, strayCourses, d.name, courseName), `${d.name} / ${courseName}`).toEqual(legacy(strayDepts, strayCourses, d.name, courseName));
      }
    }
  });
});

describe("unconfigured departments (nothing set on them or their parent)", () => {
  const fresh = (extra: Record<string, unknown>[] = []) => [
    dept({ id: "bs", name: "Basic Science", hasSubDepartments: true, isFreshman: true }),
    dept({ id: "bs-eng", name: "Basic Science - English", parentDepartmentId: "bs", managedDepartments: ["CSE"] }),
    ...extra.map(dept),
  ];
  const cs = [course("c-bs", "B.Tech", "bs", BT, 4), course("c-cse", "B.Tech", "cse", BT, 4), course("c-plain", "B.Tech", "plain", BT, 4), course("c-plain-m", "M.Tech", "plain", MT, 2)];

  it("a freshman sub-department gets the years its branches do NOT teach", () => {
    const d = fresh([{ id: "cse", name: "CSE", courseScopes: { [BT]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } }]);
    expect(legacy(d, cs, "Basic Science - English", "B.Tech")).toEqual([1, 2, 3, 4]);
    expect(opts(d, cs, "Basic Science - English", "B.Tech")).toEqual([1]);
  });

  it("works out the shared year from the data, not a fixed number (branches teach 3-4 -> years 1-2 remain)", () => {
    const d = fresh([{ id: "cse", name: "CSE", courseScopes: { [BT]: { assignedYears: [3, 4], secondaryDepartments: [] } } }]);
    expect(opts(d, cs, "Basic Science - English", "B.Tech")).toEqual([1, 2]);
  });

  it("with no branch information at all, a freshman department offers just the course's first year", () => {
    const d = fresh([{ id: "cse", name: "CSE" }]);
    expect(opts(d, cs, "Basic Science - English", "B.Tech")).toEqual([1]);
  });

  it("when the branches claim every year, it still offers the first year rather than nothing", () => {
    const d = fresh([{ id: "cse", name: "CSE", courseScopes: { [BT]: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } } }]);
    expect(opts(d, cs, "Basic Science - English", "B.Tech")).toEqual([1]);
  });

  it("an ordinary unconfigured department is NOT treated as freshman - every year the course runs", () => {
    const d = [dept({ id: "plain", name: "Plain" })];
    expect(opts(d, cs, "Plain", "B.Tech")).toEqual([1, 2, 3, 4]);
  });

  it("a 2-year course in a 4-year college is capped to 2 years", () => {
    const d = [dept({ id: "plain", name: "Plain" })];
    expect(legacy(d, cs, "Plain", "M.Tech")).toEqual([1, 2, 3, 4]);
    expect(opts(d, cs, "Plain", "M.Tech")).toEqual([1, 2]);
  });

  it("a department explicitly marked NOT freshman is not treated as one", () => {
    const d = [dept({ id: "plain", name: "Plain", isFreshman: false, hasSubDepartments: true, secondaryDepartments: ["X"] })];
    expect(opts(d, cs, "Plain", "B.Tech")).toEqual([1, 2, 3, 4]);
  });

  it("if the course's length can't be found, the caller's fallback is returned unchanged", () => {
    const d = [dept({ id: "plain", name: "Plain" })];
    expect(opts(d, [], "Plain", "B.Tech")).toBe(FALLBACK);
  });
});
