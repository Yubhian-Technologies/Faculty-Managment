import { describe, expect, it } from "vitest";
import { coreDepartmentsWithSections, departmentHasSections, departmentsWithSections } from "./departmentSectionScope";
import type { Department } from "@/types";

const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

// Shaped after a real college: a Basic Science parent that holds nothing, four
// per-subject children that each manage branches, and the branches themselves
// which are where sections are actually filed.
const BASIC = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true, managedDepartments: ["CSE", "CSBS", "IT", "EEE"] });
const BS_CHEM = dept({ id: "bsc", name: "Basic Science - Chemistry", parentDepartmentId: "bs", managedDepartments: ["CSE", "CSBS"] });
const BS_ENG = dept({ id: "bse", name: "Basic Science - English", parentDepartmentId: "bs", managedDepartments: ["EEE"] });
const CSE = dept({ id: "cse", name: "CSE" });
const CSBS = dept({ id: "csbs", name: "CSBS" });
const EEE = dept({ id: "eee", name: "EEE" });
const EMPTY = dept({ id: "x", name: "Nothing Here" });
const ALL = [BASIC, BS_CHEM, BS_ENG, CSE, CSBS, EEE, EMPTY];

// Only the branches hold sections - which is the whole point.
const SECTIONS = ["CSE", "CSBS", "EEE"];

describe("departmentHasSections", () => {
  it("includes a department whose own name is on sections", () => {
    expect(departmentHasSections(CSE, SECTIONS)).toBe(true);
  });

  // The case the feature exists for: no sections of its own, but the branches
  // it manages have them.
  it("includes a shared-first-year department through the branches it manages", () => {
    expect(departmentHasSections(BS_CHEM, SECTIONS)).toBe(true);
    expect(departmentHasSections(BS_ENG, SECTIONS)).toBe(true);
  });

  // The one the Office asked to be rid of.
  it("excludes a parent container that holds nothing itself", () => {
    expect(departmentHasSections(BASIC, SECTIONS)).toBe(false);
  });

  // ...but a parent that genuinely runs its own sections still qualifies.
  it("includes a parent that does have sections of its own", () => {
    const runsOwn = dept({ id: "p", name: "Runs Own", hasSubDepartments: true });
    expect(departmentHasSections(runsOwn, ["Runs Own"])).toBe(true);
  });

  it("excludes a department with nothing of its own and nothing managed", () => {
    expect(departmentHasSections(EMPTY, SECTIONS)).toBe(false);
  });

  it("excludes a department whose managed branches have no sections either", () => {
    const manager = dept({ id: "m", name: "Manager", managedDepartments: ["Nothing Here"] });
    expect(departmentHasSections(manager, SECTIONS)).toBe(false);
  });

  it("ignores surrounding whitespace on either side", () => {
    expect(departmentHasSections(dept({ id: "w", name: "CSE" }), ["  CSE  "])).toBe(true);
  });
});

describe("departmentsWithSections", () => {
  it("keeps only the departments that resolve to sections, in order", () => {
    expect(departmentsWithSections(ALL, SECTIONS).map((d) => d.name)).toEqual([
      "Basic Science - Chemistry", "Basic Science - English", "CSE", "CSBS", "EEE",
    ]);
  });

  it("leaves out an inactive department even when it has sections", () => {
    const retired = dept({ id: "r", name: "Retired", isActive: false });
    expect(departmentsWithSections([retired], ["Retired"])).toEqual([]);
  });

  // A college that has not created a single section yet would otherwise be left
  // with no Department filter at all - six live ones are in exactly that state.
  it("falls back to every active department when nothing has sections", () => {
    expect(departmentsWithSections(ALL, []).map((d) => d.name)).toEqual(ALL.map((d) => d.name));
  });

  it("does not fall back as soon as one department qualifies", () => {
    expect(departmentsWithSections(ALL, ["CSE"]).map((d) => d.name))
      .toEqual(["Basic Science - Chemistry", "CSE"]);
  });
});

describe("coreDepartmentsWithSections", () => {
  it("lists the managed branches that have sections, sorted", () => {
    expect(coreDepartmentsWithSections(BS_CHEM, SECTIONS)).toEqual(["CSBS", "CSE"]);
  });

  // A branch named in the configuration but with no sections yet would be a
  // dead option, so it is left out.
  it("leaves out a managed branch with no sections", () => {
    const m = dept({ id: "m", name: "M", managedDepartments: ["CSE", "Nothing Here"] });
    expect(coreDepartmentsWithSections(m, SECTIONS)).toEqual(["CSE"]);
  });

  it("is empty for a department that manages nothing", () => {
    expect(coreDepartmentsWithSections(CSE, SECTIONS)).toEqual([]);
    expect(coreDepartmentsWithSections(undefined, SECTIONS)).toEqual([]);
  });

  it("de-duplicates a branch listed twice", () => {
    const m = dept({ id: "m", name: "M", managedDepartments: ["CSE", "CSE"] });
    expect(coreDepartmentsWithSections(m, SECTIONS)).toEqual(["CSE"]);
  });
});
