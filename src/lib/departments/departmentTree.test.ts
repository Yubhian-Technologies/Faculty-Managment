import { describe, expect, it } from "vitest";
import type { Department } from "@/types";
import {
  coreDepartmentOptions,
  departmentFilterOptions,
  isContainerDepartment,
  managedCoreCandidates,
  rollupDepartmentNames,
  rollupDepartmentNamesForPick,
} from "./departmentTree";

const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

// ── Shape A: a parent that only organises, children that each manage branches ──
const BS = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true });
const BSM = dept({ id: "bsm", name: "Basic Science - Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS", "CSE"] });
const BSP = dept({ id: "bsp", name: "Basic Science - Physics", parentDepartmentId: "bs", managedDepartments: ["IT"] });
const AIDS = dept({ id: "aids", name: "AIDS" });
const CSE = dept({ id: "cse", name: "CSE" });
const IT = dept({ id: "it", name: "IT" });
const VIT = [BS, BSM, BSP, AIDS, CSE, IT];
const VIT_SECTIONS = ["AIDS", "CSE", "IT"]; // sections are filed under the branches

// ── Shapes B/C/D (a women's university): no Basic Science parent; a core with no sections of its own;
//    cores that run sections AND have a sub-department that does ──
const MATHS = dept({ id: "m", name: "BS Maths", managedDepartments: ["AI", "ECE", "CSE2"] });
const ENG = dept({ id: "e", name: "BS English", managedDepartments: ["CSE2"] });
const AI = dept({ id: "ai", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false });
const AIDS2 = dept({ id: "ai1", name: "AIDS2", parentDepartmentId: "ai" });
const AIML = dept({ id: "ai2", name: "AIML", parentDepartmentId: "ai" });
const ECE = dept({ id: "ece", name: "ECE", hasSubDepartments: true });
const VLSI = dept({ id: "vlsi", name: "VLSI", parentDepartmentId: "ece" });
const CSE2 = dept({ id: "cse2", name: "CSE2", hasSubDepartments: true });
const CYBER = dept({ id: "cy", name: "Cyber Security", parentDepartmentId: "cse2" });
const VWU = [MATHS, ENG, AI, AIDS2, AIML, ECE, VLSI, CSE2, CYBER];
const VWU_SECTIONS = ["AIDS2", "AIML", "ECE", "VLSI", "CSE2", "Cyber Security"];

describe("isContainerDepartment", () => {
  it("is true for a parent flagged as running no sections", () => {
    expect(isContainerDepartment(AI, VWU)).toBe(true);
  });
  it("is not guessed while the section list is unknown", () => {
    expect(isContainerDepartment(BS, VIT)).toBe(false);
    expect(isContainerDepartment(ECE, VWU)).toBe(false);
  });
  it("is true for a parent with children and nothing filed under its own name", () => {
    expect(isContainerDepartment(BS, VIT, false)).toBe(true);
  });
  it("is false for a parent that has sections of its own (ECE, CSE)", () => {
    expect(isContainerDepartment(ECE, VWU, true)).toBe(false);
    expect(isContainerDepartment(CSE2, VWU, true)).toBe(false);
  });
  it("is false for a department with no children or no sub-department flag", () => {
    expect(isContainerDepartment(AIDS, VIT, false)).toBe(false);
    expect(isContainerDepartment(MATHS, VWU, false)).toBe(false);
    const flaggedButChildless = dept({ id: "z", name: "Z", hasSubDepartments: true });
    expect(isContainerDepartment(flaggedButChildless, [flaggedButChildless], false)).toBe(false);
  });
});

describe("rollupDepartmentNames", () => {
  it("rolls a container parent up to itself plus every sub-department", () => {
    expect(rollupDepartmentNames(VIT, "Basic Science", false)).toEqual(["Basic Science", BSM.name, BSP.name]);
    expect(rollupDepartmentNames(VWU, "AI")).toEqual(["AI", "AIDS2", "AIML"]);
  });
  it("is the exact name for everything else - nothing that works today changes", () => {
    expect(rollupDepartmentNames(VIT, BSM.name, false)).toEqual([BSM.name]);
    expect(rollupDepartmentNames(VIT, "CSE", true)).toEqual(["CSE"]);
    expect(rollupDepartmentNames(VWU, "ECE", true)).toEqual(["ECE"]);
    expect(rollupDepartmentNames(VWU, "CSE2", true)).toEqual(["CSE2"]);
    expect(rollupDepartmentNames(VWU, "BS Maths", false)).toEqual(["BS Maths"]);
  });
  it("keeps an unknown name as typed rather than dropping it", () => {
    expect(rollupDepartmentNames(VIT, "Stray Name")).toEqual(["Stray Name"]);
    expect(rollupDepartmentNames(VIT, "")).toEqual([]);
  });
  it("decides from the section list for the client helper", () => {
    expect(rollupDepartmentNamesForPick(VIT, "Basic Science", VIT_SECTIONS)).toEqual(["Basic Science", BSM.name, BSP.name]);
    expect(rollupDepartmentNamesForPick(VWU, "ECE", VWU_SECTIONS)).toEqual(["ECE"]);
    // Sections not loaded yet: do not guess, only the explicit flag counts.
    expect(rollupDepartmentNamesForPick(VIT, "Basic Science", null)).toEqual(["Basic Science"]);
  });
});

// ── Shape E: the branches configured as a CROSS-LISTING rather than as
//    managedDepartments. Every department at VISHNU WOMEN'S UNIVERSITY and
//    YUBHIAN is set up this way, and reading only managedDepartments left them
//    with no Core Department filter at all.
const X_MATHS = dept({ id: "xm", name: "BS Maths X", secondaryDepartments: ["CSD", "CSM"] });
const X_CSD = dept({ id: "xd", name: "CSD" });
const X_CSM = dept({ id: "xs", name: "CSM" });
const XLIST = [X_MATHS, X_CSD, X_CSM];
const XLIST_SECTIONS = ["CSD", "CSM"];

describe("core departments configured as a cross-listing", () => {
  it("offers them exactly as managedDepartments would", () => {
    expect(coreDepartmentOptions(XLIST, ["BS Maths X"], XLIST_SECTIONS)).toEqual(["CSD", "CSM"]);
  });

  it("still leaves out one with no sections", () => {
    expect(coreDepartmentOptions(XLIST, ["BS Maths X"], ["CSD"])).toEqual(["CSD"]);
  });

  it("merges the two fields without repeating a branch named in both", () => {
    const both = dept({ id: "b", name: "Both", managedDepartments: ["CSD"], secondaryDepartments: ["CSD", "CSM"] });
    expect(coreDepartmentOptions([both, X_CSD, X_CSM], ["Both"], XLIST_SECTIONS)).toEqual(["CSD", "CSM"]);
  });

  // A container parent picks up what its children cross-list, the same way it
  // picks up what they manage.
  it("rolls up a child's cross-listing to the parent", () => {
    const parent = dept({ id: "p", name: "BS X", hasSubDepartments: true });
    const child = dept({ id: "c", name: "BS X - Maths", parentDepartmentId: "p", secondaryDepartments: ["CSD"] });
    expect(coreDepartmentOptions([parent, child, X_CSD], ["BS X"], XLIST_SECTIONS)).toEqual(["CSD"]);
  });
});

describe("managedCoreCandidates / coreDepartmentOptions", () => {
  it("a sub-department lists what it manages", () => {
    expect(coreDepartmentOptions(VIT, [BSM.name], VIT_SECTIONS)).toEqual(["AIDS", "CSE"]);
  });
  it("a container parent lists what its sub-departments manage, even though it manages nothing itself", () => {
    expect(managedCoreCandidates(VIT, BS)).toEqual(expect.arrayContaining(["AIDS", "CSE", "IT"]));
    expect(coreDepartmentOptions(VIT, ["Basic Science"], VIT_SECTIONS)).toEqual(["AIDS", "CSE", "IT"]);
  });
  it("an HOD's whole scope gives the union", () => {
    expect(coreDepartmentOptions(VIT, [BSM.name, BSP.name], VIT_SECTIONS)).toEqual(["AIDS", "CSE", "IT"]);
  });
  // The women's-university case: the manager groups "AI", but no section is filed under AI.
  it("expands a managed branch that holds no sections to the sub-branches that do", () => {
    // "AI" itself is dropped (no section under it); its sub-branches AIDS2/AIML are kept.
    expect(coreDepartmentOptions(VWU, ["BS Maths"], VWU_SECTIONS)).toEqual(["AIDS2", "AIML", "CSE2", "Cyber Security", "ECE", "VLSI"]);
  });
  it("offers a managed branch AND its sub-department when both hold sections (ECE -> VLSI)", () => {
    const opts = coreDepartmentOptions(VWU, ["BS Maths"], VWU_SECTIONS);
    expect(opts).toEqual(expect.arrayContaining(["ECE", "VLSI"]));
  });
  it("offers a managed branch's sub-department (CSE2 -> Cyber Security) for the other manager", () => {
    expect(coreDepartmentOptions(VWU, ["BS English"], VWU_SECTIONS)).toEqual(["CSE2", "Cyber Security"]);
  });
  it("drops a configured branch that has no sections yet", () => {
    expect(coreDepartmentOptions(VIT, [BSM.name], ["CSE"])).toEqual(["CSE"]);
  });
  it("is empty for a department that manages nothing, or when nothing is picked", () => {
    expect(coreDepartmentOptions(VIT, ["CSE"], VIT_SECTIONS)).toEqual([]);
    expect(coreDepartmentOptions(VIT, [], VIT_SECTIONS)).toEqual([]);
  });
});

describe("departmentFilterOptions", () => {
  const names = (opts: ReturnType<typeof departmentFilterOptions>) => opts.map((o) => `${"-".repeat(o.depth)}${o.department.name}`);

  it("offers a container parent again, with its sub-departments listed beneath it", () => {
    expect(names(departmentFilterOptions(VIT, VIT, VIT_SECTIONS))).toEqual([
      "Basic Science", "-Basic Science - Maths", "-Basic Science - Physics", "AIDS", "CSE", "IT",
    ]);
  });
  it("does not offer a parent that holds nothing when none of its sub-departments qualify", () => {
    // BSP manages IT, which has no sections here, so neither BSP nor its parent is a real choice.
    expect(names(departmentFilterOptions([BS, BSP, AIDS], VIT, ["AIDS"]))).toEqual(["AIDS"]);
  });
  it("offers the parent as soon as one sub-department qualifies, but not the sub-departments that do not", () => {
    expect(names(departmentFilterOptions([BS, BSM, BSP, AIDS], VIT, ["AIDS"]))).toEqual([
      "Basic Science", "-Basic Science - Maths", "AIDS",
    ]);
  });
  it("keeps a parent that runs sections exactly as today and indents its sub-department", () => {
    const opts = names(departmentFilterOptions(VWU, VWU, VWU_SECTIONS));
    expect(opts).toContain("ECE");
    expect(opts).toContain("-VLSI");
    expect(opts).toContain("CSE2");
    expect(opts).toContain("-Cyber Security");
    // AI holds no sections, so it is a container; its children are offered under it.
    expect(opts.indexOf("AI")).toBeGreaterThanOrEqual(0);
    expect(opts.indexOf("-AIDS2")).toBe(opts.indexOf("AI") + 1);
  });
  it("lists a standalone shared-first-year department like any other department", () => {
    expect(names(departmentFilterOptions(VWU, VWU, VWU_SECTIONS))).toEqual(expect.arrayContaining(["BS Maths", "BS English"]));
  });
  it("is unchanged for a college with no hierarchy: same departments, same order, no indent", () => {
    const flat = [dept({ id: "a", name: "A" }), dept({ id: "b", name: "B" })];
    expect(names(departmentFilterOptions(flat, flat, ["A", "B"]))).toEqual(["A", "B"]);
  });
  it("falls back to every active department when nothing has sections yet", () => {
    expect(names(departmentFilterOptions(VIT, VIT, []))).toEqual(
      expect.arrayContaining(["Basic Science", "AIDS", "CSE", "IT"])
    );
  });
  it("never offers an inactive department", () => {
    const retired = dept({ id: "r", name: "Retired", isActive: false });
    expect(names(departmentFilterOptions([retired, CSE], [retired, CSE], ["Retired", "CSE"]))).toEqual(["CSE"]);
  });
  it("only lists the candidates it is given (an HOD's own scope), still grouped", () => {
    const scoped = [BSM, BSP];
    expect(names(departmentFilterOptions(scoped, VIT, VIT_SECTIONS))).toEqual(["Basic Science - Maths", "Basic Science - Physics"]);
  });
});
