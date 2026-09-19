import { describe, it, expect } from "vitest";
import { replaceNoOwnSectionsParents, type DepartmentWithId } from "@/lib/college/academicStructure";
import { findBranchManager, resolveBranchYearOwner, resolveFreshmanLandingDepartment } from "@/lib/departments/managedBranches";

// The "a flagged parent is represented by its children" rule, pinned against
// the three department shapes that actually exist across the live colleges.
// Every department picker narrows through replaceNoOwnSectionsParents, so a
// parent with parentRunsOwnSections === false is never offered as a section
// target (api/college/sections POST rejects one outright); the lookups that
// used to be keyed on that parent's name must therefore also accept a child's.
//
// The regression these guard against is silent in both directions: offering a
// choice that always fails on save, or quietly dropping a relationship the
// Principal configured on the parent.

const D = (name: string, code: string, id: string, x: Record<string, unknown> = {}) =>
  ({ id, name, code, isActive: true, ...x }) as unknown as DepartmentWithId;

// Cross-listing shape (Department.secondaryDepartments): a subject department
// feeds a flagged branch directly, with no grouping sub-department involved.
const crossListed: DepartmentWithId[] = [
  D("Maths", "MATHS", "m", { secondaryDepartments: ["Artificial Intelligence"] }),
  D("Artificial Intelligence", "AI", "ai", { hasSubDepartments: true, parentRunsOwnSections: false }),
  D("AI and Machine Learning", "AIML", "aiml", { parentDepartmentId: "ai" }),
  D("AI and Data Science", "AIDS", "aids", { parentDepartmentId: "ai" }),
  // A parent that DOES run its own sections - the control case.
  D("Electronics and Communication Engineering", "ECE", "ece", { hasSubDepartments: true }),
  D("ECE-VLSI", "ECEVLSI", "vlsi", { parentDepartmentId: "ece" }),
];

// Grouping shape (Department.managedDepartments): a sub-department of a common
// first-year department manages the branch, and that branch is itself flagged.
const grouped: DepartmentWithId[] = [
  D("BASIC SCIENCE", "BS", "bs", { hasSubDepartments: true, parentRunsOwnSections: false }),
  D("BASIC SCIENCE ENGLISH", "BSE", "bse", { parentDepartmentId: "bs", managedDepartments: ["Information Technology", "Artificial Intelligence"] }),
  D("Information Technology", "IT", "it", {}),
  D("Artificial Intelligence", "AI", "ai", { hasSubDepartments: true, parentRunsOwnSections: false }),
  D("AI and Machine Learning", "AIML", "aiml", { parentDepartmentId: "ai" }),
  D("AI and Data Science", "AIDS", "aids", { parentDepartmentId: "ai" }),
];

// Grouping shape with only plain branches - the majority of live colleges.
// Nothing here may change behaviour at all.
const plain: DepartmentWithId[] = [
  D("BASIC SCIENCE", "BS", "bs", { hasSubDepartments: true, parentRunsOwnSections: false, secondaryDepartments: ["CIVIL", "IT"] }),
  D("Basic Science - Maths", "BSM", "bsm", { parentDepartmentId: "bs", managedDepartments: ["CIVIL"] }),
  D("CIVIL", "CIVIL", "civ", {}),
  D("IT", "IT", "it", {}),
];

describe("no-own-sections parents are represented by their children", () => {
  it("replaces a flagged branch with its children in a picker", () => {
    expect(replaceNoOwnSectionsParents(crossListed, ["Artificial Intelligence"]))
      .toEqual(["AI and Machine Learning", "AI and Data Science"]);
  });

  it("leaves a parent that runs its own sections untouched", () => {
    expect(replaceNoOwnSectionsParents(crossListed, ["Electronics and Communication Engineering"]))
      .toEqual(["Electronics and Communication Engineering"]);
  });

  it("keeps a flagged parent that has no children yet, so the list is never empty", () => {
    const lone = [D("X", "X", "x", { hasSubDepartments: true, parentRunsOwnSections: false })];
    expect(replaceNoOwnSectionsParents(lone, ["X"])).toEqual(["X"]);
  });

  it("keeps a name that resolves to no department (legacy / stale reference)", () => {
    expect(replaceNoOwnSectionsParents(grouped, ["Removed Dept"])).toEqual(["Removed Dept"]);
  });

  it("de-duplicates when a parent and one of its children are both listed", () => {
    expect(replaceNoOwnSectionsParents(grouped, ["Artificial Intelligence", "AI and Machine Learning"]))
      .toEqual(["AI and Machine Learning", "AI and Data Science"]);
  });

  it("gives a child the manager configured on its flagged parent", () => {
    expect(findBranchManager(grouped, "AI and Machine Learning")?.department.code).toBe("BSE");
    // The parent itself still resolves - existing rows filed under it stay reachable.
    expect(findBranchManager(grouped, "Artificial Intelligence")?.department.code).toBe("BSE");
  });

  it("splits ownership by year exactly as it does for a plain branch", () => {
    const withYears: DepartmentWithId[] = grouped.map((d) =>
      d.code === "BSE" ? ({ ...d, assignedYears: [1] } as DepartmentWithId) : d
    );
    expect(resolveBranchYearOwner(withYears, "AI and Machine Learning", 1)).toBe("BASIC SCIENCE ENGLISH");
    expect(resolveBranchYearOwner(withYears, "AI and Machine Learning", 2)).toBe("AI and Machine Learning");
  });

  it("lands a first-year student on the managing sub-department via a stand-in child", () => {
    expect(resolveFreshmanLandingDepartment(grouped, "BASIC SCIENCE", "AI and Machine Learning"))
      .toBe("BASIC SCIENCE ENGLISH");
    expect(resolveFreshmanLandingDepartment(grouped, "BASIC SCIENCE", "Information Technology"))
      .toBe("BASIC SCIENCE ENGLISH");
  });

  it("changes nothing for a college with only plain branches", () => {
    expect(replaceNoOwnSectionsParents(plain, ["CIVIL", "IT"])).toEqual(["CIVIL", "IT"]);
    expect(findBranchManager(plain, "CIVIL")?.department.code).toBe("BSM");
    expect(findBranchManager(plain, "IT")).toBeNull();
    expect(resolveFreshmanLandingDepartment(plain, "BASIC SCIENCE", "CIVIL")).toBe("Basic Science - Maths");
    expect(resolveFreshmanLandingDepartment(plain, "BASIC SCIENCE", "IT")).toBe("BASIC SCIENCE");
  });
});
