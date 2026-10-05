import { describe, expect, it } from "vitest";
import { admitYear, notConfiguredMessage, resolveTaughtYears, type YearsDepartment } from "@/lib/college/taughtYears";
import { yearsInScope } from "@/lib/departments/hodScope";
import { teachableYearsForDepartment } from "@/lib/subjects/teachableYears";
import type { Department } from "@/types";

// Finding 1: an EMPTY Years Taught is "not configured", never "teaches everything".

const BTECH = "btech";
// The VIT shape: a no-own-sections parent (Basic Science, year 1) with a managed branch (IT, own years 2-4).
const bs: YearsDepartment = { id: "bs", name: "Basic Science", hasSubDepartments: true, parentRunsOwnSections: false, managedDepartments: ["Basic Science - Maths"], courseScopes: { [BTECH]: { assignedYears: [1], secondaryDepartments: ["IT"] } } };
const bsMaths: YearsDepartment = { id: "bsm", name: "Basic Science - Maths", parentDepartmentId: "bs", managedDepartments: ["IT"] };
const itDept: YearsDepartment = { id: "it", name: "IT", courseScopes: { [BTECH]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } };
const lonely: YearsDepartment = { id: "lonely", name: "Lonely" }; // nothing configured, no parent
const cleared: YearsDepartment = { id: "clr", name: "Cleared", courseScopes: { [BTECH]: { assignedYears: [], secondaryDepartments: [] } } };
const all = [bs, bsMaths, itDept, lonely, cleared];

describe("resolveTaughtYears", () => {
  it("own years -> status own", () => expect(resolveTaughtYears(itDept, all, BTECH)).toEqual({ status: "own", years: [2, 3, 4] }));
  it("a sub-department with none of its own inherits its parent's", () => expect(resolveTaughtYears(bsMaths, all, BTECH)).toEqual({ status: "inherited", years: [1] }));
  it("nothing configured -> NONE, never every year", () => {
    expect(resolveTaughtYears(lonely, all, BTECH)).toEqual({ status: "none", years: [] });
    expect(resolveTaughtYears(cleared, all, BTECH)).toEqual({ status: "none", years: [] });
  });
  it("flat years still count when there is no per-course entry (legacy colleges)", () => {
    expect(resolveTaughtYears({ id: "x", name: "X", assignedYears: [1, 2] }, all, BTECH).years).toEqual([1, 2]);
  });
});

describe("admitYear", () => {
  const args = (department: YearsDepartment, year: number, viaManagedBranch?: boolean) =>
    admitYear({ department, allDepartments: all, catalogId: BTECH, year, viaManagedBranch });

  it("admits a taught year, refuses another", () => {
    expect(args(itDept, 3)).toEqual({ ok: true, via: "own" });
    expect(args(itDept, 1)).toEqual({ ok: false, reason: "NOT_TAUGHT" });
  });
  it("EMPTY Years Taught refuses EVERY year (NOT_CONFIGURED), including through a cleared scope", () => {
    for (const y of [1, 2, 3, 4, 5]) {
      expect(args(lonely, y)).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
      expect(args(cleared, y)).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    }
  });
  it("a sub-department's inherited years are admitted", () => expect(args(bsMaths, 1)).toEqual({ ok: true, via: "inherited" }));
  it("a branch's shared year is admitted ONLY when reached through its manager (the VIT Year-1 sections)", () => {
    expect(args(itDept, 1, true)).toEqual({ ok: true, via: "manager" });
    expect(args(itDept, 1, false)).toEqual({ ok: false, reason: "NOT_TAUGHT" });
    expect(args(itDept, 1)).toEqual({ ok: false, reason: "NOT_TAUGHT" });
  });
  it("the manager never opens a year it does not teach", () => expect(args(itDept, 5, true)).toEqual({ ok: false, reason: "NOT_TAUGHT" }));
});

describe("notConfiguredMessage", () => {
  it("names the department, the course and the year", () => {
    expect(notConfiguredMessage("Lonely", 2, "B.Tech")).toBe(`"Lonely" has no Years Taught set for B.Tech, so Year 2 can't be used yet. Ask the Principal to set its Years Taught first.`);
    expect(notConfiguredMessage(undefined, 1)).toContain("This department has no Years Taught set");
  });
});

describe("shared year pickers no longer widen an empty list to 'all years'", () => {
  const asDept = (d: YearsDepartment) => d as unknown as Department;
  it("yearsInScope: configured -> its years; nothing configured anywhere -> NO years (was: every year)", () => {
    expect(yearsInScope(4, [asDept(itDept)], new Map(), false, BTECH, [asDept(itDept)])).toEqual([2, 3, 4]);
    expect(yearsInScope(4, [asDept(lonely)], new Map(), false, BTECH, [asDept(lonely)])).toEqual([]);
  });
  it("teachableYearsForDepartment: configured/inherited -> its years; unconfigured -> NONE (was: all years minus fed)", () => {
    const course = { durationYears: 4, catalogId: BTECH };
    expect(teachableYearsForDepartment(course, asDept(itDept), all.map(asDept))).toEqual([2, 3, 4]);
    expect(teachableYearsForDepartment(course, asDept(bsMaths), all.map(asDept))).toEqual([1]);
    expect(teachableYearsForDepartment(course, asDept(lonely), all.map(asDept))).toEqual([]);
  });
});
