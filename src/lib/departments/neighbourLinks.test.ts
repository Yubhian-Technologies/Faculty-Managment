import { describe, expect, it } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { resolveNeighbourLinks as resolveJs } from "../../../scripts/lib/neighbourLinksCore.mjs";
import { resolveNeighbourLinks, syncNeighbourLinksForCollege, type NeighbourLinkInput } from "./neighbourLinks";

const d = (over: Partial<NeighbourLinkInput> & { id: string; name: string }): NeighbourLinkInput => ({
  parentDepartmentId: undefined,
  hasSubDepartments: undefined,
  parentRunsOwnSections: undefined,
  managedDepartments: undefined,
  assignedYears: undefined,
  courseScopes: undefined,
  ...over,
});

describe("script/app parity", () => {
  it("the plain-JS script mirror resolves identically to the TS module", () => {
    const ai = d({ id: "ai", name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false });
    const aiml = d({ id: "aiml", name: "CSE[AIML]", parentDepartmentId: "ai" });
    const bsmaths = d({ id: "bsmaths", name: "BASIC SCIENCE - MATHS", assignedYears: [1], managedDepartments: ["ARTIFICIAL INTELLIGENCE"] });
    const all = [ai, aiml, bsmaths];
    for (const dept of all) {
      expect(resolveJs(dept, all)).toEqual(resolveNeighbourLinks(dept, all));
    }
  });
});

describe("Case 1 (VWU) - flat parent fed by a flat neighbour", () => {
  const it_ = d({ id: "it", name: "INFORMATION TECHNOLOGY" });
  const bsp = d({ id: "bsp", name: "BASIC SCIENCE - PHYSICS", assignedYears: [1], managedDepartments: ["INFORMATION TECHNOLOGY", "MECHANICAL ENGINEERING"] });
  const all = [it_, bsp];

  it("IT's own record resolves BASIC SCIENCE - PHYSICS as its neighbour for year 1", () => {
    expect(resolveNeighbourLinks(it_, all)).toEqual([{ neighbourDepartmentId: "bsp", neighbourDepartmentName: "BASIC SCIENCE - PHYSICS", years: [1] }]);
  });
  it("the neighbour itself has no neighbourLinks (nothing feeds it)", () => {
    expect(resolveNeighbourLinks(bsp, all)).toEqual([]);
  });
});

describe("Case 2 (VWU) - ghost's true children resolve the neighbour via the ghost-parent fallback", () => {
  const ai = d({ id: "ai", name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false });
  const aiml = d({ id: "aiml", name: "CSE[AIML]", parentDepartmentId: "ai" });
  const aids = d({ id: "aids", name: "CSE[AIDS]", parentDepartmentId: "ai" });
  const bsmaths = d({ id: "bsmaths", name: "BASIC SCIENCE - MATHS", assignedYears: [1], managedDepartments: ["ARTIFICIAL INTELLIGENCE"] });
  const all = [ai, aiml, aids, bsmaths];

  it("AIML and AIDS each resolve BASIC SCIENCE - MATHS directly, even though it names the GHOST, not them, in managedDepartments", () => {
    expect(resolveNeighbourLinks(aiml, all)).toEqual([{ neighbourDepartmentId: "bsmaths", neighbourDepartmentName: "BASIC SCIENCE - MATHS", years: [1] }]);
    expect(resolveNeighbourLinks(aids, all)).toEqual([{ neighbourDepartmentId: "bsmaths", neighbourDepartmentName: "BASIC SCIENCE - MATHS", years: [1] }]);
  });
  it("the ghost ITSELF also resolves BASIC SCIENCE - MATHS (it's literally named in managedDepartments) - accurate to show on the ghost's own page even though no section is ever filed under its name", () => {
    expect(resolveNeighbourLinks(ai, all)).toEqual([{ neighbourDepartmentId: "bsmaths", neighbourDepartmentName: "BASIC SCIENCE - MATHS", years: [1] }]);
  });
});

describe("Case 4 (VWU) - parent fed directly; its true child is NOT (real authorization gap confirmed against the code)", () => {
  // CSE's own HOD already has unconditional full access to CSE[Cyber Security] via
  // scope.ts's childDepartmentNames rollup (no year check) - BASIC SCIENCE - ENGLISH's
  // managedDepartments only names "COMPUTER SCIENCE AND ENGINEERING", never the child
  // directly, and CSE is not a ghost (parentRunsOwnSections:true) so the ghost-parent
  // fallback doesn't apply to its child either. findBranchManager therefore correctly
  // finds no manager for CSE[Cyber Security] - this matches canHodEditDepartmentYear's
  // real behavior exactly (see managedBranches.ts), so neighbourLinks must agree.
  const cse = d({ id: "cse", name: "COMPUTER SCIENCE AND ENGINEERING", hasSubDepartments: true, parentRunsOwnSections: true });
  const cyber = d({ id: "cyber", name: "CSE [CYBER SECURITY]", parentDepartmentId: "cse" });
  const bsEnglish = d({ id: "bse", name: "BASIC SCIENCE - ENGLISH", assignedYears: [1], managedDepartments: ["COMPUTER SCIENCE AND ENGINEERING"] });
  const all = [cse, cyber, bsEnglish];

  it("CSE resolves BASIC SCIENCE - ENGLISH as its neighbour for year 1", () => {
    expect(resolveNeighbourLinks(cse, all)).toEqual([{ neighbourDepartmentId: "bse", neighbourDepartmentName: "BASIC SCIENCE - ENGLISH", years: [1] }]);
  });
  it("CSE [CYBER SECURITY] (the true child) has NO neighbourLinks - its year 1 is CSE's own HOD's via child rollup, not the neighbour's", () => {
    expect(resolveNeighbourLinks(cyber, all)).toEqual([]);
  });
});

describe("syncNeighbourLinksForCollege - the live write-path sync called from the departments PATCH/POST/DELETE routes", () => {
  const C = "colleges/c1";

  it("writes neighbourLinks only for departments whose resolved value changed, leaves the rest untouched", async () => {
    const { db, firestore } = fakeFs({
      [`${C}/departments/it`]: { name: "INFORMATION TECHNOLOGY" },
      [`${C}/departments/me`]: { name: "MECHANICAL ENGINEERING", neighbourLinks: [{ neighbourDepartmentId: "bsp", neighbourDepartmentName: "BASIC SCIENCE - PHYSICS", years: [1] }] }, // already correct
      [`${C}/departments/bsp`]: { name: "BASIC SCIENCE - PHYSICS", assignedYears: [1], managedDepartments: ["INFORMATION TECHNOLOGY", "MECHANICAL ENGINEERING"] },
    });
    await syncNeighbourLinksForCollege(firestore, "c1");

    expect(db.docs.get(`${C}/departments/it`)?.neighbourLinks).toEqual([
      { neighbourDepartmentId: "bsp", neighbourDepartmentName: "BASIC SCIENCE - PHYSICS", years: [1] },
    ]);
    // ME's was already correct - must not appear in the write log (no redundant write).
    expect(db.writeLog.some((w) => w.path === `${C}/departments/me`)).toBe(false);
    expect(db.writeLog.some((w) => w.path === `${C}/departments/it`)).toBe(true);
  });

  it("clears a stale link when the department stops being fed (e.g. its manager's managedDepartments entry was removed)", async () => {
    const { db, firestore } = fakeFs({
      [`${C}/departments/it`]: { name: "INFORMATION TECHNOLOGY", neighbourLinks: [{ neighbourDepartmentId: "bsp", neighbourDepartmentName: "BASIC SCIENCE - PHYSICS", years: [1] }] },
      [`${C}/departments/bsp`]: { name: "BASIC SCIENCE - PHYSICS", assignedYears: [1], managedDepartments: [] }, // no longer manages IT
    });
    await syncNeighbourLinksForCollege(firestore, "c1");
    expect(db.docs.get(`${C}/departments/it`)?.neighbourLinks).toEqual([]);
  });
});

describe("one-owner-per-branch: at most one entry, never many neighbours for the same department", () => {
  it("returns a single-element array even when a branch (hypothetically, pre-existing bad data) appears in two managers' lists - findBranchManager already picks the first match deterministically", () => {
    const branch = d({ id: "b", name: "ECE" });
    const managerA = d({ id: "ma", name: "BS-Chem", assignedYears: [1], managedDepartments: ["ECE"] });
    const managerB = d({ id: "mb", name: "BS-Physics", assignedYears: [1], managedDepartments: ["ECE"] });
    const result = resolveNeighbourLinks(branch, [branch, managerA, managerB]);
    expect(result).toHaveLength(1);
  });
});
