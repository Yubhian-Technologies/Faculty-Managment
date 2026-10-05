import { describe, expect, it } from "vitest";
import { offeredYears, offeredYearsAcross } from "./departmentYears";
import type { Department } from "@/types";

const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

const CAT = "cat-btech";

// Shaped after a real college: a common Basic Science parent holding year 1,
// with per-subject children that carry no years of their own, and branches
// that run years 2-4 themselves.
const BASIC = dept({ id: "bs", name: "Basic Science", courseScopes: { [CAT]: { assignedYears: [1], secondaryDepartments: [] } } });
const BS_PHYSICS = dept({ id: "bsp", name: "Basic Science - Physics", parentDepartmentId: "bs" });
const CIVIL = dept({ id: "ce", name: "Civil Engineering", assignedYears: [2, 3, 4] });
const UNSET = dept({ id: "un", name: "Unconfigured" });
const ALL = [BASIC, BS_PHYSICS, CIVIL, UNSET];

describe("offeredYears", () => {
  it("uses the department's own per-course years", () => {
    expect(offeredYears(BASIC, ALL, CAT, [])).toEqual([1]);
  });

  it("uses flat assignedYears when there is no per-course override", () => {
    expect(offeredYears(CIVIL, ALL, CAT, [])).toEqual([2, 3, 4]);
  });

  // The case that left every sub-department with an empty picker.
  it("falls back to the parent for a sub-department with none of its own", () => {
    expect(offeredYears(BS_PHYSICS, ALL, CAT, [])).toEqual([1]);
  });

  // The configured years win - a stray shared-first-year section filed under
  // Civil must not add year 1, which belongs to whoever runs the common year.
  it("prefers configured years over the years sections happen to be in", () => {
    expect(offeredYears(CIVIL, ALL, CAT, [1, 2, 3])).toEqual([2, 3, 4]);
  });

  it("falls back to the sections' years for an unconfigured department", () => {
    expect(offeredYears(UNSET, ALL, CAT, [2, 3])).toEqual([2, 3]);
    expect(offeredYears(undefined, ALL, CAT, [2, 3])).toEqual([2, 3]);
  });

  it("returns nothing when unconfigured with no sections either", () => {
    expect(offeredYears(UNSET, ALL, CAT, [])).toEqual([]);
  });

  // A per-course override must not leak across courses.
  it("ignores a per-course override belonging to a different catalogue", () => {
    expect(offeredYears(BASIC, ALL, "cat-other", [])).toEqual([]);
  });

  it("drops non-years and sorts", () => {
    expect(offeredYears(UNSET, ALL, CAT, [4, 0, 2, -1, 2])).toEqual([2, 4]);
  });
});

describe("offeredYearsAcross", () => {
  it("unions the years of every named department", () => {
    expect(offeredYearsAcross(["Basic Science", "Civil Engineering"], ALL, CAT, [])).toEqual([1, 2, 3, 4]);
  });

  it("resolves a sub-department through its parent in the union too", () => {
    expect(offeredYearsAcross(["Basic Science - Physics", "Civil Engineering"], ALL, CAT, [])).toEqual([1, 2, 3, 4]);
  });

  // The Basic Science HOD bug: naming only her own department must give the
  // one year she runs, never the branches' years 2-4.
  it("gives a managing department only its own year", () => {
    expect(offeredYearsAcross(["Basic Science"], ALL, CAT, [1, 2, 3, 4])).toEqual([1]);
  });

  it("falls back when none of the named departments are configured", () => {
    expect(offeredYearsAcross(["Unconfigured"], ALL, CAT, [3, 4])).toEqual([3, 4]);
  });

  // A name matching no department doc must not silently empty the picker.
  it("falls back when a name matches no department at all", () => {
    expect(offeredYearsAcross(["Does Not Exist"], ALL, CAT, [1, 2])).toEqual([1, 2]);
  });

  it("returns nothing when there is neither configuration nor a section", () => {
    expect(offeredYearsAcross(["Unconfigured"], ALL, CAT, [])).toEqual([]);
  });
});
