import { describe, expect, it } from "vitest";
import { planNeighbourConnection, type ConnectionInput } from "./neighbourConnection";

const d = (over: Partial<ConnectionInput> & { id: string; name: string }): ConnectionInput => ({
  parentDepartmentId: undefined,
  hasSubDepartments: undefined,
  parentRunsOwnSections: undefined,
  managedDepartments: undefined,
  secondaryDepartments: undefined,
  assignedYears: undefined,
  courseScopes: undefined,
  ...over,
});

// Every neighbour fixture below already manages a PLACEHOLDER department (not
// itself part of `all`) - deriveRoleOnly only recognizes a department as
// NEIGHBOUR once it's already feeder-shaped, which a genuinely blank,
// never-configured department structurally can't be told apart from a plain
// PARENT (a standalone freshman department can legitimately hold its own
// students directly, with no feeder relationship at all). That's a real
// product boundary, not a gap this dropdown needs to solve: a brand-new
// neighbour gets its FIRST connection via the existing create/tick-box flow;
// this dropdown is for connecting it to ADDITIONAL departments afterward.

describe("Case 1 - flat parent, no children", () => {
  const it_ = d({ id: "it", name: "INFORMATION TECHNOLOGY" });
  const bsp = d({ id: "bsp", name: "BASIC SCIENCE - PHYSICS", managedDepartments: ["PLACEHOLDER"], secondaryDepartments: ["PLACEHOLDER"] });
  const all = [it_, bsp];

  it("connecting IT to BASIC SCIENCE - PHYSICS adds IT's own name to BOTH arrays alongside its existing claim - matches real VWU data exactly", () => {
    const plan = planNeighbourConnection(it_, all, "bsp");
    expect(plan).toEqual({
      connectTo: { departmentId: "bsp", managedDepartments: ["PLACEHOLDER", "INFORMATION TECHNOLOGY"], secondaryDepartments: ["PLACEHOLDER", "INFORMATION TECHNOLOGY"] },
    });
  });
});

describe("Case 2 - ghost with true children", () => {
  const ai = d({ id: "ai", name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false });
  const aiml = d({ id: "aiml", name: "CSE[AIML]", parentDepartmentId: "ai" });
  const aids = d({ id: "aids", name: "CSE[AIDS]", parentDepartmentId: "ai" });
  const bsmaths = d({ id: "bsmaths", name: "BASIC SCIENCE - MATHS", managedDepartments: ["PLACEHOLDER"], secondaryDepartments: ["PLACEHOLDER"] });
  const all = [ai, aiml, aids, bsmaths];

  it("connecting the GHOST writes the ghost's OWN name to managedDepartments, but only its CHILDREN's names to secondaryDepartments - matches real VWU data exactly", () => {
    const plan = planNeighbourConnection(ai, all, "bsmaths");
    expect(plan).toEqual({
      connectTo: {
        departmentId: "bsmaths",
        managedDepartments: ["PLACEHOLDER", "ARTIFICIAL INTELLIGENCE"],
        secondaryDepartments: ["PLACEHOLDER", "CSE[AIML]", "CSE[AIDS]"],
      },
    });
  });

  it("refuses to connect a true CHILD directly - only a PARENT or GHOST may use this dropdown", () => {
    const plan = planNeighbourConnection(aiml, all, "bsmaths");
    expect(plan).toEqual({ error: "Only a parent or ghost department can be connected to a neighbour" });
  });
});

describe("Case 4 - parent with a true child that ALSO holds its own sections", () => {
  const cse = d({ id: "cse", name: "COMPUTER SCIENCE AND ENGINEERING", hasSubDepartments: true, parentRunsOwnSections: true });
  const cyber = d({ id: "cyber", name: "CSE [CYBER SECURITY]", parentDepartmentId: "cse" });
  const bsEnglish = d({ id: "bse", name: "BASIC SCIENCE - ENGLISH", managedDepartments: ["PLACEHOLDER"], secondaryDepartments: ["PLACEHOLDER"] });
  const all = [cse, cyber, bsEnglish];

  it("connecting CSE writes only CSE's own name to managedDepartments, but BOTH CSE's and its child's name to secondaryDepartments - matches real VWU data exactly", () => {
    const plan = planNeighbourConnection(cse, all, "bse");
    expect(plan).toEqual({
      connectTo: {
        departmentId: "bse",
        managedDepartments: ["PLACEHOLDER", "COMPUTER SCIENCE AND ENGINEERING"],
        secondaryDepartments: ["PLACEHOLDER", "COMPUTER SCIENCE AND ENGINEERING", "CSE [CYBER SECURITY]"],
      },
    });
  });
});

describe("rejects a non-neighbour target", () => {
  it("refuses to connect to a department that isn't a NEIGHBOUR/NEIGHBOUR_SUB", () => {
    const parentA = d({ id: "a", name: "IT" });
    const parentB = d({ id: "b", name: "ME" }); // another plain parent, not a neighbour
    const plan = planNeighbourConnection(parentA, [parentA, parentB], "b");
    expect(plan).toEqual({ error: '"ME" is not a neighbour department' });
  });
});

describe("moving from one neighbour to another", () => {
  const it_ = d({ id: "it", name: "INFORMATION TECHNOLOGY" });
  const oldN = d({ id: "old", name: "OLD NEIGHBOUR", managedDepartments: ["INFORMATION TECHNOLOGY", "OTHER"], secondaryDepartments: ["INFORMATION TECHNOLOGY"] });
  const newN = d({ id: "new", name: "NEW NEIGHBOUR", managedDepartments: ["PLACEHOLDER"], secondaryDepartments: ["PLACEHOLDER"] });
  const all = [it_, oldN, newN];

  it("removes IT from the old neighbour (leaving its other claims intact) and adds it to the new one, in one plan", () => {
    const plan = planNeighbourConnection(it_, all, "new");
    if ("error" in plan) throw new Error("unexpected error: " + plan.error);
    expect(plan.disconnectFrom).toEqual({ departmentId: "old", managedDepartments: ["OTHER"], secondaryDepartments: [] });
    expect(plan.connectTo).toEqual({ departmentId: "new", managedDepartments: ["PLACEHOLDER", "INFORMATION TECHNOLOGY"], secondaryDepartments: ["PLACEHOLDER", "INFORMATION TECHNOLOGY"] });
  });

  it("refuses a no-op reconnect to the SAME neighbour it's already connected to", () => {
    const plan = planNeighbourConnection(it_, all, "old");
    expect(plan).toEqual({ error: "Already connected to this neighbour" });
  });

  it("disconnecting (neighbourId: null) only produces disconnectFrom, no connectTo", () => {
    const plan = planNeighbourConnection(it_, all, null);
    expect(plan).toEqual({ disconnectFrom: { departmentId: "old", managedDepartments: ["OTHER"], secondaryDepartments: [] } });
  });

  it("disconnecting when not currently connected to anyone is a no-op empty plan", () => {
    const plan = planNeighbourConnection(d({ id: "me", name: "MECHANICAL ENGINEERING" }), [...all, d({ id: "me", name: "MECHANICAL ENGINEERING" })], null);
    expect(plan).toEqual({});
  });
});
