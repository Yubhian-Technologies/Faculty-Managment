import { describe, expect, it } from "vitest";
import type { Department } from "@/types";
import { groupDepartmentsByParent } from "./departmentTree";
import { sectionCoreOptions, sectionIsOfCore, sectionMatchesPick } from "./sectionDepartmentPick";
import { sectionMatchesDepartmentFilter } from "./hodScope";

const CAT = "btech";
const scope = (years: number[]) => ({ [CAT]: { assignedYears: years, secondaryDepartments: [] } });
const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

// VIT: a parent that holds nothing, sub-departments that each manage branches (year 1 only).
const BS = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true, courseScopes: scope([1]) });
const BSM = dept({ id: "bsm", name: "BS-Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS", "AIML"] });
const BSP = dept({ id: "bsp", name: "BS-Physics", parentDepartmentId: "bs", managedDepartments: ["CSE"] });
const AIDS = dept({ id: "aids", name: "AIDS", courseScopes: scope([2, 3, 4]) });
const AIML = dept({ id: "aiml", name: "AIML", courseScopes: scope([2, 3, 4]) });
const CSE = dept({ id: "cse", name: "CSE", courseScopes: scope([2, 3, 4]) });
// VWU: AI holds nothing and is split into two branches that hold the real sections; ECE runs its own AND has VLSI.
const AI = dept({ id: "ai", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false });
const CAI = dept({ id: "cai", name: "CSE [AI&ML]", parentDepartmentId: "ai", courseScopes: scope([2, 3, 4]) });
const CAD = dept({ id: "cad", name: "CSE [AI&DS]", parentDepartmentId: "ai", courseScopes: scope([2, 3, 4]) });
const ECE = dept({ id: "ece", name: "ECE", hasSubDepartments: true, courseScopes: scope([2, 3, 4]) });
const VLSI = dept({ id: "vlsi", name: "VLSI", parentDepartmentId: "ece", courseScopes: scope([2, 3, 4]) });
const ALL = [BS, BSM, BSP, AIDS, AIML, CSE, AI, CAI, CAD, ECE, VLSI];

const sec = (department: string, year: number) => ({ department, year });
const SECTIONS = [
  sec("AIDS", 1), sec("AIML", 1), sec("CSE", 1), sec("AIDS", 2), sec("AIML", 3), sec("CSE", 4),
  sec("CSE [AI&ML]", 2), sec("CSE [AI&ML]", 3), sec("CSE [AI&DS]", 2), sec("CSE [AI&DS]", 4),
  sec("ECE", 3), sec("VLSI", 3),
];
const NAMES = Array.from(new Set(SECTIONS.map((s) => s.department)));
const pick = (name: string) => SECTIONS.filter((s) => sectionMatchesPick(ALL, name, s, CAT, NAMES)).map((s) => `${s.department}:${s.year}`);

describe("sectionMatchesPick", () => {
  it("Basic Science runs the first year of its branches and nothing else (unchanged)", () => {
    expect(pick("Basic Science")).toEqual(["AIDS:1", "AIML:1", "CSE:1"]);
  });
  it("a sub-department runs only the first year of the branches it manages (unchanged)", () => {
    expect(pick("BS-Maths")).toEqual(["AIDS:1", "AIML:1"]);
    expect(pick("BS-Physics")).toEqual(["CSE:1"]);
  });
  it("a container reaches its own branches' sections in every year (was empty)", () => {
    expect(pick("AI")).toEqual(["CSE [AI&ML]:2", "CSE [AI&ML]:3", "CSE [AI&DS]:2", "CSE [AI&DS]:4"]);
  });
  it("a branch is its full roster, and one of AI's branches is just its own", () => {
    expect(pick("AIDS")).toEqual(["AIDS:1", "AIDS:2"]);
    expect(pick("CSE [AI&ML]")).toEqual(["CSE [AI&ML]:2", "CSE [AI&ML]:3"]);
  });
  it("a parent that runs its own sections stays exactly its own (ECE does not swallow VLSI)", () => {
    expect(pick("ECE")).toEqual(["ECE:3"]);
    expect(pick("VLSI")).toEqual(["VLSI:3"]);
  });
  it("never matches less than the old rule did - for every department and every section", () => {
    for (const d of ALL) {
      for (const s of SECTIONS) {
        const before = sectionMatchesDepartmentFilter(ALL, d.name, s.department, s.year, CAT);
        const after = sectionMatchesPick(ALL, d.name, s, CAT, NAMES);
        if (before) expect(after, `${d.name} / ${s.department}:${s.year}`).toBe(true);
      }
    }
  });
  it("a section filed under the sub-department itself (older cross-listed shape) is found by the parent", () => {
    const legacy = [...SECTIONS, sec("BS-Maths", 1)];
    expect(legacy.filter((s) => sectionMatchesPick(ALL, "Basic Science", s, CAT, [...NAMES, "BS-Maths"])).map((s) => s.department))
      .toContain("BS-Maths");
  });
});

describe("sectionCoreOptions / sectionIsOfCore", () => {
  it("Basic Science and a sub-department offer the managed branches that have sections", () => {
    expect(sectionCoreOptions(ALL, "Basic Science", NAMES)).toEqual(["AIDS", "AIML", "CSE"]);
    expect(sectionCoreOptions(ALL, "BS-Maths", NAMES)).toEqual(["AIDS", "AIML"]);
  });
  it("a container offers its own branches", () => {
    expect(sectionCoreOptions(ALL, "AI", NAMES)).toEqual(["CSE [AI&DS]", "CSE [AI&ML]"]);
  });
  it("a parent that runs its own sections, or a plain branch, offers none", () => {
    expect(sectionCoreOptions(ALL, "ECE", NAMES)).toEqual([]);
    expect(sectionCoreOptions(ALL, "AIDS", NAMES)).toEqual([]);
    expect(sectionCoreOptions(ALL, "", NAMES)).toEqual([]);
  });
  it("a Core pick narrows the Department pick and never widens it", () => {
    const inBs = SECTIONS.filter((s) => sectionMatchesPick(ALL, "Basic Science", s, CAT, NAMES));
    expect(inBs.filter((s) => sectionIsOfCore(ALL, "AIDS", s.department)).map((s) => `${s.department}:${s.year}`)).toEqual(["AIDS:1"]);
    const inAi = SECTIONS.filter((s) => sectionMatchesPick(ALL, "AI", s, CAT, NAMES));
    expect(inAi.filter((s) => sectionIsOfCore(ALL, "CSE [AI&DS]", s.department)).map((s) => `${s.department}:${s.year}`))
      .toEqual(["CSE [AI&DS]:2", "CSE [AI&DS]:4"]);
  });
  it("a managed branch that holds no sections stands for its sub-branches", () => {
    expect(sectionIsOfCore(ALL, "AI", "CSE [AI&ML]")).toBe(true);
    expect(sectionIsOfCore(ALL, "AI", "CSE")).toBe(false);
    expect(sectionIsOfCore(ALL, "", "CSE")).toBe(false);
  });
});

describe("groupDepartmentsByParent", () => {
  const names = (opts: ReturnType<typeof groupDepartmentsByParent>) => opts.map((o) => `${o.depth}:${o.department.name}${o.container ? "*" : ""}`);
  it("lists every active department, each sub-department right under its parent, and marks a container", () => {
    expect(names(groupDepartmentsByParent(ALL, NAMES))).toEqual([
      "0:AI*", "1:CSE [AI&DS]", "1:CSE [AI&ML]", "0:AIDS", "0:AIML",
      "0:Basic Science*", "1:BS-Maths", "1:BS-Physics", "0:CSE", "0:ECE", "1:VLSI",
    ]);
  });
  it("trusts only the explicit flag before sections have loaded", () => {
    expect(names(groupDepartmentsByParent(ALL))).toContain("0:AI*");
    expect(names(groupDepartmentsByParent(ALL))).toContain("0:Basic Science");
  });
  it("never lists an inactive department and never loses an active one", () => {
    const retired = dept({ id: "r", name: "Retired", isActive: false });
    const out = groupDepartmentsByParent([...ALL, retired], NAMES).map((o) => o.department.name);
    expect(out).not.toContain("Retired");
    expect(out.sort()).toEqual(ALL.map((d) => d.name).sort());
  });
});
