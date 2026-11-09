import { describe, expect, it } from "vitest";
import { ALL_BRANCHES, assignedScope, branchesOf, checkAssignment, groupBranchLabel, isMultiBranch, paperBranchLabel, scopeBranches, sectionsForScope, servesBranch } from "./assignments";
import type { TeachingRow } from "./sections";

const row = (branch: string, sectionId: string, facultyId: string): TeachingRow => ({ subjectId: "m1", subjectName: "Maths", subjectCode: "MA", branch, sectionId, sectionName: sectionId, facultyId, facultyName: facultyId });
const rows = [row("CSE", "A", "f1"), row("CSE", "B", "f2"), row("ECE", "C", "f1"), row("EEE", "D", "f3")];

describe("HOD-assigned setters", () => {
  it("branches and sections of a scope", () => {
    expect(branchesOf(rows, "m1")).toEqual(["CSE", "ECE", "EEE"]);
    expect(sectionsForScope(rows, "m1", "CSE").map((s) => s.sectionId)).toEqual(["A", "B"]);
    const all = sectionsForScope(rows, "m1", ALL_BRANCHES);
    expect(all.map((s) => `${s.branch}:${s.sectionId}`)).toEqual(["CSE:A", "CSE:B", "ECE:C", "EEE:D"]);
  });
  it("a whole-subject paper serves every branch it lists", () => {
    expect(servesBranch({ branch: "CSE" }, "CSE")).toBe(true);
    expect(servesBranch({ branch: "CSE" }, "ECE")).toBe(false);
    expect(servesBranch({ branch: ALL_BRANCHES, branches: ["CSE", "ECE"] }, "ECE")).toBe(true);
    expect(servesBranch({ branch: ALL_BRANCHES, branches: ["CSE"] }, "EEE")).toBe(false);
  });
  it("who is assigned where", () => {
    expect(assignedScope([{ subjectId: "m1", branch: "CSE", facultyIds: ["f9", "f8"] }, { subjectId: "m1", branch: "ECE", facultyIds: ["f9"] }], "m1", "f9")).toEqual(["CSE", "ECE"]);
  });
  const base = { candidateIds: new Set(["f1", "f2", "f9"]), startedIds: new Set<string>(), currentIds: [] as string[], namesById: new Map([["f2", "Ravi"]]) };
  it("per branch and whole subject can't be mixed", () => {
    expect(checkAssignment({ ...base, existing: [{ branch: "CSE", scope: "BRANCH", facultyIds: ["f1"], facultyNames: [] }], scope: "SUBJECT", branch: ALL_BRANCHES, facultyIds: ["f9"] })).toHaveLength(1);
    expect(checkAssignment({ ...base, existing: [{ branch: ALL_BRANCHES, scope: "SUBJECT", facultyIds: ["f9"], facultyNames: [] }], scope: "BRANCH", branch: "CSE", facultyIds: ["f1"] })).toHaveLength(1);
    expect(checkAssignment({ ...base, existing: [{ branch: "ECE", scope: "BRANCH", facultyIds: ["f1"], facultyNames: [] }], scope: "BRANCH", branch: "CSE", facultyIds: ["f1", "f2"] })).toEqual([]);
  });
  it("only candidates; a setter who started can't be removed", () => {
    expect(checkAssignment({ ...base, existing: [], scope: "BRANCH", branch: "CSE", facultyIds: ["zz"] })).toHaveLength(1);
    expect(checkAssignment({ ...base, startedIds: new Set(["f2"]), currentIds: ["f1", "f2"], existing: [], scope: "BRANCH", branch: "CSE", facultyIds: ["f1"] })).toEqual(["Ravi already started - they can't be removed"]);
    expect(checkAssignment({ ...base, currentIds: ["f1"], existing: [], scope: "BRANCH", branch: "CSE", facultyIds: [] })).toEqual([]);
  });
});

describe("one paper for a group of branches", () => {
  const rows: TeachingRow[] = [
    { subjectId: "s", subjectName: "M", subjectCode: "M1", branch: "CSE", sectionId: "c1", sectionName: "A", facultyId: "f1", facultyName: "F1" },
    { subjectId: "s", subjectName: "M", subjectCode: "M1", branch: "EEE", sectionId: "e1", sectionName: "A", facultyId: "f2", facultyName: "F2" },
    { subjectId: "s", subjectName: "M", subjectCode: "M1", branch: "ECE", sectionId: "x1", sectionName: "A", facultyId: "f3", facultyName: "F3" },
  ];
  const group = groupBranchLabel(["EEE", "CSE"]);
  const base = { candidateIds: new Set(["f1", "f2"]), startedIds: new Set<string>(), currentIds: [], namesById: new Map<string, string>() };

  it("is labelled by its branches and covers only their sections", () => {
    expect(group).toBe("CSE + EEE");
    expect(isMultiBranch(group)).toBe(true);
    expect(scopeBranches(group)).toEqual(["CSE", "EEE"]);
    expect(sectionsForScope(rows, "s", group).map((s) => s.sectionId)).toEqual(["c1", "e1"]);
    expect(servesBranch({ branch: group, branches: ["CSE", "EEE"] }, "EEE")).toBe(true);
    expect(servesBranch({ branch: group, branches: ["CSE", "EEE"] }, "ECE")).toBe(false);
  });
  it("a branch is in one paper only; a group needs two branches; never mixed with all branches", () => {
    expect(checkAssignment({ ...base, existing: [], scope: "GROUP", branch: group, facultyIds: ["f1"] })).toEqual([]);
    expect(checkAssignment({ ...base, existing: [], scope: "GROUP", branch: "CSE", facultyIds: ["f1"] })).toContain("Pick at least two branches for one paper");
    expect(checkAssignment({ ...base, existing: [{ branch: "CSE", scope: "BRANCH", facultyIds: ["f1"], facultyNames: ["F1"] }], scope: "GROUP", branch: group, facultyIds: ["f2"] })[0])
      .toBe("CSE already has a paper (its own setters) - remove that first");
    expect(checkAssignment({ ...base, existing: [{ branch: group, scope: "GROUP", facultyIds: ["f1"], facultyNames: ["F1"] }], scope: "BRANCH", branch: "EEE", facultyIds: ["f2"] })[0])
      .toBe("EEE already has a paper (CSE + EEE) - remove that first");
    expect(checkAssignment({ ...base, existing: [{ branch: ALL_BRANCHES, scope: "SUBJECT", facultyIds: ["f1"], facultyNames: ["F1"] }], scope: "GROUP", branch: group, facultyIds: ["f2"] }))
      .toContain("This subject has one paper for all branches - remove that assignment first to assign per branch");
  });
  it("the printed header lists the paper's branches with their own sections", () => {
    const code = (n: string) => ({ CSE: "CSE", EEE: "EEE" } as Record<string, string>)[n] ?? "";
    expect(paperBranchLabel({ branch: group, branches: ["CSE", "EEE"], sections: [{ sectionName: "A", branch: "CSE" }, { sectionName: "B", branch: "CSE" }, { sectionName: "A", branch: "EEE" }] }, code))
      .toEqual({ branch: "CSE (A, B) · EEE (A)", sections: [] });
    expect(paperBranchLabel({ branch: "CSE", sections: [{ sectionName: "A" }] }, code)).toEqual({ branch: "CSE", sections: ["A"] });
  });
});
