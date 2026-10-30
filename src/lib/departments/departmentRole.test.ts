import { describe, expect, it } from "vitest";
import { deriveDepartmentRole as deriveJs } from "../../../scripts/lib/departmentRoleCore.mjs";
import { deriveDepartmentRole, type RoleInput } from "./departmentRole";

// Fixtures below are the real shapes read from VWU and VIT (Firestore project
// faculty-management-37e84) during the architecture audit, trimmed to the
// fields this module reads. See the approved plan's mapping table for the
// case numbers referenced in each describe block.
const d = (over: Partial<RoleInput> & { id: string; name: string }): RoleInput => ({
  parentDepartmentId: undefined,
  hasSubDepartments: undefined,
  parentRunsOwnSections: undefined,
  managedDepartments: undefined,
  secondaryDepartments: undefined,
  assignedYears: undefined,
  courseScopes: undefined,
  ...over,
});

describe("script/app parity", () => {
  it("the plain-JS script mirror classifies identically to the TS module", () => {
    const all: RoleInput[] = [
      d({ id: "ai", name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false }),
      d({ id: "aiml", name: "CSE[AIML]", parentDepartmentId: "ai" }),
      d({ id: "bsm", name: "BASIC SCIENCE - MATHS", managedDepartments: ["ARTIFICIAL INTELLIGENCE"], secondaryDepartments: ["CSE[AIML]"] }),
    ];
    for (const dept of all) {
      expect(deriveJs(dept, all)).toEqual(deriveDepartmentRole(dept, all));
    }
  });
});

describe("Case 1 (VWU) - flat parent + neighbour, no child", () => {
  const it_ = d({ id: "it", name: "INFORMATION TECHNOLOGY" });
  const me = d({ id: "me", name: "MECHANICAL ENGINEERING" });
  const bsp = d({ id: "bsp", name: "BASIC SCIENCE - PHYSICS", assignedYears: [1], managedDepartments: ["INFORMATION TECHNOLOGY", "MECHANICAL ENGINEERING"], secondaryDepartments: ["INFORMATION TECHNOLOGY", "MECHANICAL ENGINEERING"] });
  const all = [it_, me, bsp];

  it("IT and ME are PARENT", () => {
    expect(deriveDepartmentRole(it_, all)).toEqual({ role: "PARENT", flags: [] });
    expect(deriveDepartmentRole(me, all)).toEqual({ role: "PARENT", flags: [] });
  });
  it("BASIC SCIENCE - PHYSICS is NEIGHBOUR, no flags", () => {
    expect(deriveDepartmentRole(bsp, all)).toEqual({ role: "NEIGHBOUR", flags: [] });
  });
});

describe("Case 2 (VWU) - ghost + children + neighbour", () => {
  const ai = d({ id: "ai", name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false });
  const aiml = d({ id: "aiml", name: "CSE [ARTIFICIAL INTELLIGENCE & MACHINE LEARNING]", parentDepartmentId: "ai" });
  const aids = d({ id: "aids", name: "CSE [ARTIFICIAL INTELLIGENCE & DATA SCIENCE]", parentDepartmentId: "ai" });
  const bsmaths = d({
    id: "bsmaths", name: "BASIC SCIENCE - MATHS", assignedYears: [1],
    managedDepartments: ["ARTIFICIAL INTELLIGENCE"],
    secondaryDepartments: ["CSE [ARTIFICIAL INTELLIGENCE & DATA SCIENCE]", "CSE [ARTIFICIAL INTELLIGENCE & MACHINE LEARNING]"],
  });
  const all = [ai, aiml, aids, bsmaths];

  it("ARTIFICIAL INTELLIGENCE is GHOST, no flags", () => {
    expect(deriveDepartmentRole(ai, all)).toEqual({ role: "GHOST", flags: [] });
  });
  it("AIML and AIDS are CHILD", () => {
    expect(deriveDepartmentRole(aiml, all)).toEqual({ role: "CHILD", flags: [] });
    expect(deriveDepartmentRole(aids, all)).toEqual({ role: "CHILD", flags: [] });
  });
  it("BASIC SCIENCE - MATHS is NEIGHBOUR, and does NOT flag targeting the ghost (managedDepartments legitimately names it; secondaryDepartments correctly names the children)", () => {
    expect(deriveDepartmentRole(bsmaths, all)).toEqual({ role: "NEIGHBOUR", flags: [] });
  });
});

describe("Case 3 (VIT) - neighbour dept + neighbour-sub-depts managing real parents", () => {
  const basicScience = d({ id: "bs", name: "Basic Science", hasSubDepartments: true, parentRunsOwnSections: true });
  const bse = d({ id: "bse", name: "Basic Science - English", parentDepartmentId: "bs", assignedYears: [1], managedDepartments: ["Civil Engineering", "Electrical and Electronics Engineering", "Mechanical Engineering"] });
  const bsc = d({ id: "bsc", name: "Basic Science - Chemistry", parentDepartmentId: "bs", assignedYears: [1], managedDepartments: ["Computer Science and Engineering", "Computer Science and Business System"] });
  const bsmaths = d({ id: "bsmaths", name: "Basic Science - Mathematics", parentDepartmentId: "bs" }); // unconfigured: no managedDepartments of its own yet
  const cse = d({ id: "cse", name: "Computer Science and Engineering" });
  const civil = d({ id: "civil", name: "Civil Engineering" });
  const all = [basicScience, bse, bsc, bsmaths, cse, civil];

  it("Basic Science (the container) is NEIGHBOUR, even though parentRunsOwnSections is literally true", () => {
    expect(deriveDepartmentRole(basicScience, all)).toEqual({ role: "NEIGHBOUR", flags: [] });
  });
  it("Basic Science - English/Chemistry are NEIGHBOUR_SUB, no flags (each has its own managedDepartments)", () => {
    expect(deriveDepartmentRole(bse, all)).toEqual({ role: "NEIGHBOUR_SUB", flags: [] });
    expect(deriveDepartmentRole(bsc, all)).toEqual({ role: "NEIGHBOUR_SUB", flags: [] });
  });
  it("Basic Science - Mathematics is NEIGHBOUR_SUB via its siblings, flagged UNCONFIGURED since it has nothing connected yet", () => {
    expect(deriveDepartmentRole(bsmaths, all)).toEqual({ role: "NEIGHBOUR_SUB", flags: ["NEIGHBOUR_SUB_UNCONFIGURED"] });
  });
  it("CSE and Civil (the real fed branches) are PARENT regardless of being fed", () => {
    expect(deriveDepartmentRole(cse, all)).toEqual({ role: "PARENT", flags: [] });
    expect(deriveDepartmentRole(civil, all)).toEqual({ role: "PARENT", flags: [] });
  });
});

describe("Case 4 (VWU) - parent + child, both own sections, + neighbour", () => {
  const cse = d({ id: "cse", name: "COMPUTER SCIENCE AND ENGINEERING", hasSubDepartments: true, parentRunsOwnSections: true });
  const cyber = d({ id: "cyber", name: "CSE [CYBER SECURITY]", parentDepartmentId: "cse" });
  const bsEnglish = d({
    id: "bse", name: "BASIC SCIENCE - ENGLISH", assignedYears: [1],
    managedDepartments: ["COMPUTER SCIENCE AND ENGINEERING"],
    secondaryDepartments: ["CSE [CYBER SECURITY]", "COMPUTER SCIENCE AND ENGINEERING"],
  });
  const all = [cse, cyber, bsEnglish];

  it("CSE (parent) is PARENT", () => {
    expect(deriveDepartmentRole(cse, all)).toEqual({ role: "PARENT", flags: [] });
  });
  it("CSE[CYBER SECURITY] (child) is CHILD", () => {
    expect(deriveDepartmentRole(cyber, all)).toEqual({ role: "CHILD", flags: [] });
  });
  it("BASIC SCIENCE - ENGLISH is NEIGHBOUR, no flags", () => {
    expect(deriveDepartmentRole(bsEnglish, all)).toEqual({ role: "NEIGHBOUR", flags: [] });
  });
});

describe("contradiction flags", () => {
  it("flags a GHOST that also claims its own years", () => {
    const ai = d({ id: "ai", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false, assignedYears: [2] });
    const child = d({ id: "c1", name: "AIML", parentDepartmentId: "ai" });
    const all = [ai, child];
    expect(deriveDepartmentRole(ai, all).flags).toContain("GHOST_HAS_OWN_YEARS");
  });

  it("flags a parentDepartmentId chain deeper than one hop", () => {
    const top = d({ id: "top", name: "Basic Science", hasSubDepartments: true });
    const mid = d({ id: "mid", name: "BS-Maths", parentDepartmentId: "top", managedDepartments: ["X"] });
    const bottom = d({ id: "bottom", name: "BS-Maths-Sub", parentDepartmentId: "mid" });
    const all = [top, mid, bottom];
    expect(deriveDepartmentRole(bottom, all).flags).toContain("PARENT_DEPARTMENT_CHAIN_DEPTH_GT_1");
  });

  it("flags a branch claimed by more than one manager at once (write-time enforcement doesn't cover pre-existing data)", () => {
    const branch = d({ id: "b", name: "ECE" });
    const managerA = d({ id: "ma", name: "BS-Chem", managedDepartments: ["ECE"] });
    const managerB = d({ id: "mb", name: "BS-Physics", managedDepartments: ["ECE"] });
    const all = [branch, managerA, managerB];
    expect(deriveDepartmentRole(branch, all).flags).toContain("MULTIPLE_MANAGERS_CLAIM_THIS_BRANCH");
  });

  it("does NOT flag a GHOST or a PARENT-with-children for being named in exactly one manager's managedDepartments (Case 2/4's designed shape)", () => {
    const ghost = d({ id: "g", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false });
    const child = d({ id: "c", name: "AIML", parentDepartmentId: "g" });
    const neighbour = d({ id: "n", name: "BS-Maths", managedDepartments: ["AI"], secondaryDepartments: ["AIML"] });
    const all = [ghost, child, neighbour];
    expect(deriveDepartmentRole(ghost, all).flags).not.toContain("MULTIPLE_MANAGERS_CLAIM_THIS_BRANCH");
  });

  it("flags a neighbour's secondaryDepartments naming a ghost directly instead of its true children", () => {
    const ghost = d({ id: "g", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false });
    const child = d({ id: "c", name: "AIML", parentDepartmentId: "g" });
    const neighbour = d({ id: "n", name: "BS-Maths", managedDepartments: ["AI"], secondaryDepartments: ["AI"] }); // misconfigured: should name "AIML"
    const all = [ghost, child, neighbour];
    expect(deriveDepartmentRole(neighbour, all).flags).toContain("SECONDARY_DEPARTMENTS_TARGETS_GHOST_DIRECTLY:AI");
  });
});
