import { describe, expect, it } from "vitest";
import { ownBranchPaperNames, reviewDepartmentsOf } from "./ownerDepartment";
import { ownBranchPaperBlockers } from "./ownBranchPapers";
import { candidatesFor, hodMayAssign, reviewDepartmentsForScope, type FacultyIndex } from "@/lib/midBank/assignmentsServer";
import { ALL_BRANCHES, GROUP_JOIN } from "@/lib/midBank/assignments";
const groupOf = (branches: string[]) => [...new Set(branches)].sort().join(GROUP_JOIN);
import type { HodDepartmentScope } from "@/lib/departments/scope";
import type { TeachingRow } from "@/lib/midBank/sections";
import type { FacultyMember } from "@/types";

// C and Data Structures: Subject Department CSE, taught in AIDS, AIML, CSE and IT; AIML prepares and approves its own.
const names = new Map([["cse", "Computer Science and Engineering"], ["aiml", "Artificial Intelligence and Machine Learning"], ["aids", "Artificial Intelligence and Data Science"], ["it", "Information Technology"]]);
const CSE = "Computer Science and Engineering", AIML = "Artificial Intelligence and Machine Learning", AIDS = "Artificial Intelligence and Data Science", IT = "Information Technology";
const cds = { ownerDepartments: [{ id: "cse", name: CSE }], ownBranchPapers: [{ id: "aiml", name: "AIML (old name)" }] };

const scopeOf = (own: string[]): HodDepartmentScope => ({
  departmentName: own[0] ?? "", departmentId: null, ownDepartmentNames: own, ownDepartmentIds: [],
  childDepartmentNames: [], childDepartmentIds: [], managedDepartmentNames: [], managedDepartmentIds: [], parentDepartmentIds: [],
});
const row = (branch: string, facultyId: string): TeachingRow => ({ subjectId: "cds", subjectName: "C and Data Structures", subjectCode: "CDS", branch, sectionId: `${branch}-A`, sectionName: "A", facultyId, facultyName: facultyId });
const rows = [row(AIDS, "f-aids"), row(AIML, "f-aiml"), row(CSE, "f-cse"), row(IT, "f-it")];

describe("Branches with their own Mid papers", () => {
  it("the branch reviews in its own branch; the Subject Department everywhere else", () => {
    expect(reviewDepartmentsOf(AIML, cds, names)).toEqual([AIML]);
    expect(reviewDepartmentsOf(CSE, cds, names)).toEqual([CSE]);
    expect(reviewDepartmentsOf(IT, cds, names)).toEqual([CSE]);
    // Matched by the department's current name, not the name saved with it.
    expect(ownBranchPaperNames(cds, names)).toEqual([AIML]);
  });

  it("is ignored without a Subject Department, and for a branch that is itself the Subject Department", () => {
    expect(ownBranchPaperNames({ ownBranchPapers: [{ id: "aiml", name: AIML }] }, names)).toEqual([]);
    expect(reviewDepartmentsOf(AIML, { ownBranchPapers: [{ id: "aiml", name: AIML }] }, names)).toEqual([AIML]);
    expect(ownBranchPaperNames({ ownerDepartments: [{ id: "cse", name: CSE }], ownBranchPapers: [{ id: "cse", name: CSE }] }, names)).toEqual([]);
  });

  it("assigning: AIML's HOD assigns AIML only; CSE's HOD the other branches; nobody one paper for all branches", () => {
    const aimlHod = scopeOf([AIML]), cseHod = scopeOf([CSE]);
    const depts = (branch: string) => reviewDepartmentsForScope(rows, cds, branch, names);
    expect(depts(AIML)).toEqual([AIML]);
    expect(depts(IT)).toEqual([CSE]);
    expect(hodMayAssign(aimlHod, depts(AIML), true)).toBe(true);
    expect(hodMayAssign(cseHod, depts(AIML), true)).toBe(false);
    expect(hodMayAssign(cseHod, depts(IT), true)).toBe(true);
    expect(hodMayAssign(aimlHod, depts(IT), true)).toBe(false);
    // One paper for all branches would cover AIML too: not offered.
    expect(depts(ALL_BRANCHES)).toEqual([]);
    // A group of CSE's branches is still CSE's; a group with AIML has two reviewers (the route needs every member assignable).
    expect(depts(groupOf([AIDS, CSE, IT]))).toEqual([CSE]);
    expect(depts(groupOf([AIML, CSE])).sort()).toEqual([AIML, CSE].sort());
  });

  it("without an own-paper branch, one paper for all branches stays with the Subject Department", () => {
    const plain = { ownerDepartments: [{ id: "cse", name: CSE }] };
    expect(reviewDepartmentsForScope(rows, plain, ALL_BRANCHES, names)).toEqual([CSE]);
    expect(reviewDepartmentsForScope(rows, plain, AIML, names)).toEqual([CSE]);
  });

  it("setters for AIML: those teaching it in AIML sections, then AIML faculty - not CSE's", () => {
    const f = (department: string): FacultyMember => ({ department, status: "ACTIVE", legalName: department } as unknown as FacultyMember);
    const index: FacultyIndex = {
      byId: new Map([["f-aiml", f(AIML)], ["x-aiml", f(AIML)], ["x-cse", f(CSE)]]),
      byDept: new Map([[AIML, [{ id: "f-aiml", f: f(AIML) }, { id: "x-aiml", f: f(AIML) }]], [CSE, [{ id: "x-cse", f: f(CSE) }]]]),
    };
    const picks = candidatesFor(index, rows, "cds", AIML, reviewDepartmentsForScope(rows, cds, AIML, names));
    expect(picks.map((c) => [c.facultyId, c.teaches])).toEqual([["f-aiml", true], ["x-aiml", false]]);
  });
});

describe("switching a branch is refused while work is in flight", () => {
  const deadlines = new Map([["d1", { deadline: "2026-11-30", midNumber: 1 }], ["old", { deadline: "2026-01-10", midNumber: 2 }]]);
  const today = "2026-11-14";

  it("setters assigned for that branch in an open deadline block it", () => {
    const out = ownBranchPaperBlockers([AIML], [{ branch: AIML, facultyIds: ["f"], deadlineId: "d1" }], [], deadlines, today);
    expect(out[0]).toContain("setters are already assigned for Mid 1");
  });

  it("one paper for all branches covers it too", () => {
    expect(ownBranchPaperBlockers([AIML], [{ branch: ALL_BRANCHES, facultyIds: ["f"], deadlineId: "d1" }], [], deadlines, today)[0]).toContain("one paper for all branches");
  });

  it("a paper not yet approved blocks it; approved, withdrawn and closed-deadline assignments don't", () => {
    expect(ownBranchPaperBlockers([AIML], [], [{ branch: AIML, deadlineId: "old", approval: "SUBMITTED" }], deadlines, today)[0]).toContain("waiting for approval");
    expect(ownBranchPaperBlockers([AIML], [{ branch: AIML, facultyIds: ["f"], deadlineId: "old" }], [
      { branch: AIML, deadlineId: "d1", approval: "APPROVED" },
      { branch: AIML, deadlineId: "d1", withdrawn: { at: "x" } },
    ], deadlines, today)).toEqual([]);
  });

  it("other branches' work does not block it", () => {
    expect(ownBranchPaperBlockers([AIML], [{ branch: groupOf([CSE, IT]), branches: [CSE, IT], facultyIds: ["f"], deadlineId: "d1" }], [{ branch: CSE, deadlineId: "d1" }], deadlines, today)).toEqual([]);
  });
});
