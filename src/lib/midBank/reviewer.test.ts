import { describe, expect, it } from "vitest";
import type { HodDepartmentScope } from "@/lib/departments/scope";
import { reviewingDepartment, seesBranchProgress } from "./reviewer";

const scope = (s: Partial<HodDepartmentScope>): HodDepartmentScope => ({
  departmentName: "", departmentId: "", ownDepartmentNames: [], ownDepartmentIds: [], childDepartmentNames: [], childDepartmentIds: [],
  managedDepartmentNames: [], managedDepartmentIds: [], parentDepartmentIds: [], ...s,
} as HodDepartmentScope);

// The English HOD coordinates the 1st-year sections of Civil / EEE / Mech (managed branches).
const english = scope({ ownDepartmentNames: ["Basic Science - English"], managedDepartmentNames: ["Civil Engineering", "Electrical and Electronics Engineering", "Mechanical Engineering"] });
const basicScience = scope({ ownDepartmentNames: ["Basic Science"], childDepartmentNames: ["Basic Science - English", "Basic Science - Mathematics"], managedDepartmentNames: ["Civil Engineering"] });

describe("reviewingDepartment", () => {
  it("a Subject Department is reviewed by its own HOD, not by a managed-branch coordinator", () => {
    expect(reviewingDepartment(english, ["Basic Science - English"], true)).toBe("Basic Science - English");
    expect(reviewingDepartment(english, ["Electrical and Electronics Engineering"], true)).toBe("");
    expect(reviewingDepartment(english, ["Electrical and Electronics Engineering", "Mechanical Engineering"], true)).toBe("");
  });
  it("the parent department's HOD reviews a sub-department's subjects", () => {
    expect(reviewingDepartment(basicScience, ["Basic Science - Mathematics"], true)).toBe("Basic Science - Mathematics");
    expect(reviewingDepartment(basicScience, ["Computer Science and Engineering"], true)).toBe("");
  });
  it("no Subject Department: the branch HOD decides, managed branches included (as before)", () => {
    expect(reviewingDepartment(english, ["Mechanical Engineering"], false)).toBe("Mechanical Engineering");
    expect(reviewingDepartment(english, ["Computer Science and Engineering"], false)).toBe("");
  });
});

describe("seesBranchProgress", () => {
  const civilHod = scope({ ownDepartmentNames: ["Civil Engineering"] });
  it("a coordinator of a branch's 1st year sees there only subjects without a Subject Department", () => {
    expect(seesBranchProgress(english, "Civil Engineering", true)).toBe(false);
    expect(seesBranchProgress(english, "Civil Engineering", false)).toBe(true);
  });
  it("the branch's own HOD keeps the progress of every subject there", () => {
    expect(seesBranchProgress(civilHod, "Civil Engineering", true)).toBe(true);
    expect(seesBranchProgress(civilHod, "Mechanical Engineering", true)).toBe(false);
  });
});
