import { describe, expect, it } from "vitest";
import { canHodEditDepartmentYear, canHodExclusivelyOwnDepartmentYear, resolveBranchYearOwner } from "./managedBranches";

// VWU: EVT is a true sub-department of ECE (which runs its own sections); BASIC SCIENCE - CHEMISTRY runs ECE's 1st year.
// EVT's 1st year follows ECE's: the Chemistry HOD manages it, EVT's own HOD has it from the 2nd year on.
const ece = { id: "ece", name: "ELECTRONICS & COMMUNICATION ENGINEERING", hasSubDepartments: true, parentRunsOwnSections: true };
const evt = { id: "evt", name: "ELECTRONICS ENGINEERING [VLSI DESIGN & TECHNOLOGY]", parentDepartmentId: "ece" };
const chem = { id: "bsc", name: "BASIC SCIENCE - CHEMISTRY", assignedYears: [1], managedDepartments: ["CIVIL ENGINEERING", "ELECTRONICS & COMMUNICATION ENGINEERING"] };
const all = [ece, evt, chem];

const scopeOf = (own: string[], managed: string[] = [], children: string[] = []) => ({ ownDepartmentNames: own, childDepartmentNames: children, managedDepartmentNames: managed });
const chemHod = scopeOf([chem.name], [ece.name, evt.name]);
const evtHod = scopeOf([evt.name]);

describe("a sub-department follows its parent branch's shared-year manager", () => {
  it("EVT's 1st year belongs to BASIC SCIENCE - CHEMISTRY; later years to EVT", () => {
    expect(resolveBranchYearOwner(all, evt.name, 1)).toBe(chem.name);
    expect(resolveBranchYearOwner(all, evt.name, 2)).toBe(evt.name);
  });

  it("the Chemistry HOD edits EVT year 1 only; EVT's HOD has it from year 2", () => {
    expect(canHodEditDepartmentYear(chemHod, all, evt.name, 1)).toBe(true);
    expect(canHodEditDepartmentYear(chemHod, all, evt.name, 2)).toBe(false);
    expect(canHodExclusivelyOwnDepartmentYear(evtHod, all, evt.name, 1)).toBe(false);
    expect(canHodExclusivelyOwnDepartmentYear(evtHod, all, evt.name, 2)).toBe(true);
  });

  it("a sub-department grouped by name under another department keeps that one", () => {
    const maths = { id: "bsm", name: "BASIC SCIENCE - MATHS", assignedYears: [1], managedDepartments: [evt.name] };
    expect(resolveBranchYearOwner([...all, maths], evt.name, 1)).toBe(maths.name);
  });
});
