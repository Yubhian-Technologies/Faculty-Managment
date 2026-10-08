import { describe, expect, it } from "vitest";
import type { Department } from "@/types";
import { managedSectionDepartments } from "./managedSections";

const CAT = "btech";
const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

// The real shape: years are configured per course (courseScopes), the manager
// teaches year 1 of the branches it manages, the branch's own HOD years 2-4.
const scope = (years: number[]) => ({ [CAT]: { assignedYears: years, secondaryDepartments: [] } });
const BS = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true, courseScopes: scope([1]) });
const BSM = dept({ id: "bsm", name: "BS-Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS"] });
const BSP = dept({ id: "bsp", name: "BS-Physics", parentDepartmentId: "bs", managedDepartments: ["CSE"] });
const AIDS = dept({ id: "aids", name: "AIDS", courseScopes: scope([2, 3, 4]) });
const CSE = dept({ id: "cse", name: "CSE", courseScopes: scope([2, 3, 4]) });
const ALL = [BS, BSM, BSP, AIDS, CSE];

describe("managedSectionDepartments", () => {
  it("a parent owns, for the shared year, every branch its sub-departments manage", () => {
    expect(managedSectionDepartments(ALL, "Basic Science", 1, CAT).sort()).toEqual(["AIDS", "CSE"]);
  });

  it("a sub-department owns only the branches it manages", () => {
    expect(managedSectionDepartments(ALL, "BS-Maths", 1, CAT)).toEqual(["AIDS"]);
    expect(managedSectionDepartments(ALL, "BS-Physics", 1, CAT)).toEqual(["CSE"]);
  });

  // The rule that must never loosen: later years belong to the branch's own HOD.
  it("owns nothing in a year it does not teach", () => {
    expect(managedSectionDepartments(ALL, "Basic Science", 2, CAT)).toEqual([]);
    expect(managedSectionDepartments(ALL, "BS-Maths", 3, CAT)).toEqual([]);
  });

  it("a plain branch, or an unknown name, owns nothing extra", () => {
    expect(managedSectionDepartments(ALL, "AIDS", 1, CAT)).toEqual([]);
    expect(managedSectionDepartments(ALL, "Nope", 1, CAT)).toEqual([]);
    expect(managedSectionDepartments(ALL, "", 1, CAT)).toEqual([]);
  });

  // A manager that groups a branch which holds no sections itself (AI), whose
  // sub-branches do: the sections are filed under AIML / AIDS2.
  it("reaches the sub-branches of a managed branch that holds no sections", () => {
    const AI = dept({ id: "ai", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false, courseScopes: scope([2, 3, 4]) });
    const AIML = dept({ id: "ai1", name: "AIML", parentDepartmentId: "ai" });
    const AIDS2 = dept({ id: "ai2", name: "AIDS2", parentDepartmentId: "ai" });
    const MATHS = dept({ id: "m", name: "BS Maths", managedDepartments: ["AI"], courseScopes: scope([1]) });
    expect(managedSectionDepartments([MATHS, AI, AIML, AIDS2], "BS Maths", 1, CAT).sort()).toEqual(["AI", "AIDS2", "AIML"]);
  });
});
