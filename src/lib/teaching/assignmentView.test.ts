import { describe, expect, it } from "vitest";
import type { Department } from "@/types";
import { assignmentsForFilter } from "./assignmentView";
import { departmentPickNames, subjectCoversSection } from "@/lib/departments/subjectCoverage";

const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

// VIT shape: a parent that holds no sections, sub-departments that each manage branches.
const BS = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true });
const BSM = dept({ id: "bsm", name: "BS-Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS"] });
const BSP = dept({ id: "bsp", name: "BS-Physics", parentDepartmentId: "bs", managedDepartments: ["CSE"] });
const AIDS = dept({ id: "aids", name: "AIDS" });
const CSE = dept({ id: "cse", name: "CSE" });
// Women's-university shape
const MATHS = dept({ id: "m", name: "BS Women Maths", managedDepartments: ["AI"] });
const AI = dept({ id: "ai", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false });
const AIML = dept({ id: "ai1", name: "AIML", parentDepartmentId: "ai" });
const AIDS2 = dept({ id: "ai2", name: "AIDS2", parentDepartmentId: "ai" });
const ECE = dept({ id: "ece", name: "ECE", hasSubDepartments: true });
const VLSI = dept({ id: "vlsi", name: "VLSI", parentDepartmentId: "ece" });
const ALL = [BS, BSM, BSP, AIDS, CSE, MATHS, AI, AIML, AIDS2, ECE, VLSI];

describe("departmentPickNames - what a Sub-department pick stands for", () => {
  it("a sub-department is itself plus the branches it manages", () => {
    expect([...departmentPickNames(ALL, "BS-Maths", ["AIDS", "CSE"])].sort()).toEqual(["AIDS", "BS-Maths"]);
  });
  it("a parent that holds nothing is every sub-department and every branch they manage", () => {
    expect([...departmentPickNames(ALL, "Basic Science", ["AIDS", "CSE"])].sort())
      .toEqual(["AIDS", "BS-Maths", "BS-Physics", "Basic Science", "CSE"]);
  });
  it("a manager that groups a sectionless core stands for the sub-branches the sections are filed under", () => {
    expect([...departmentPickNames(ALL, "BS Women Maths", ["AIML", "AIDS2"])].sort())
      .toEqual(["AI", "AIDS2", "AIML", "BS Women Maths"]);
  });
  it("a parent that runs its own sections stays exactly its own (ECE does not swallow VLSI)", () => {
    expect([...departmentPickNames(ALL, "ECE", ["ECE", "VLSI"])]).toEqual(["ECE"]);
  });
  it("nothing is guessed before sections have loaded: only the explicit flag counts", () => {
    expect([...departmentPickNames(ALL, "Basic Science", [])]).toEqual(["Basic Science"]);
    expect([...departmentPickNames(ALL, "AI", [])].sort()).toEqual(["AI", "AIDS2", "AIML"]);
  });
  it("an empty pick or unknown name never throws", () => {
    expect(departmentPickNames(ALL, "", []).size).toBe(0);
    expect([...departmentPickNames(ALL, "Stray", [])]).toEqual(["Stray"]);
  });
});

describe("subjectCoversSection", () => {
  const mapped = (ids: string[] = [], names: string[] = []) => ({ ids: new Set(ids), names: new Set(names) });

  it("keeps the exact id / name match it always had", () => {
    expect(subjectCoversSection(ALL, mapped(["aids"]), "AIDS")).toBe(true);
    expect(subjectCoversSection(ALL, mapped([], ["CSE"]), "CSE")).toBe(true);
    expect(subjectCoversSection(ALL, mapped(["aids"]), "CSE")).toBe(false);
  });
  it("a subject mapped to the department that manages a branch covers that branch's sections only", () => {
    expect(subjectCoversSection(ALL, mapped(["bsm"]), "AIDS")).toBe(true);
    expect(subjectCoversSection(ALL, mapped(["bsm"]), "CSE")).toBe(false);
  });
  it("covers the sub-branches of a managed branch that holds no sections itself", () => {
    expect(subjectCoversSection(ALL, mapped(["m"]), "AIML")).toBe(true);
    expect(subjectCoversSection(ALL, mapped(["m"]), "AIDS2")).toBe(true);
    expect(subjectCoversSection(ALL, mapped(["m"]), "ECE")).toBe(false);
  });
  it("is false with nothing mapped or no section department", () => {
    expect(subjectCoversSection(ALL, mapped(), "AIDS")).toBe(false);
    expect(subjectCoversSection(ALL, mapped(["bsm"]), "")).toBe(false);
  });
});

describe("assignmentsForFilter - the Current Assignments list follows the filters", () => {
  const a = (id: string, over: Record<string, unknown>) => ({ id, courseId: "c-aids", year: 1, department: "AIDS", timetableSemester: 1, ...over }) as
    { id: string; courseId?: string; year?: number | null; department?: string; timetableSemester?: number | null };
  const rows = [
    a("fy-aids-s1", {}),
    a("fy-cse-s1", { courseId: "c-cse", department: "CSE" }),
    a("fy-aids-s2", { timetableSemester: 2 }),
    a("y2-aids", { year: 2 }),
    a("other-course", { courseId: "c-mtech" }),
    a("no-semester", { timetableSemester: null }),
    a("legacy-bsm", { courseId: "c-bs", department: "BS-Maths" }),
  ];
  const base = { courseIds: new Set(["c-aids", "c-cse", "c-bs"]), year: 1, semester: 1 as number | null };

  it("no sub-department picked: the whole loaded course-year-semester, nothing else", () => {
    const ids = assignmentsForFilter(rows, { ...base, departmentNames: null }).map((r) => r.id);
    expect(ids).toEqual(["fy-aids-s1", "fy-cse-s1", "no-semester", "legacy-bsm"]);
  });
  it("a sub-department pick keeps its own and its managed branches' assignments", () => {
    const names = departmentPickNames(ALL, "BS-Maths", ["AIDS", "CSE"]);
    const ids = assignmentsForFilter(rows, { ...base, departmentNames: names }).map((r) => r.id);
    expect(ids).toEqual(["fy-aids-s1", "no-semester", "legacy-bsm"]);
  });
  it("the other sub-department's branch is not shown", () => {
    const names = departmentPickNames(ALL, "BS-Physics", ["AIDS", "CSE"]);
    expect(assignmentsForFilter(rows, { ...base, departmentNames: names }).map((r) => r.id)).toEqual(["fy-cse-s1"]);
  });
  it("the semester follows, and an assignment with no semester is never hidden by it", () => {
    const ids = assignmentsForFilter(rows, { ...base, semester: 2, departmentNames: null }).map((r) => r.id);
    expect(ids).toEqual(["fy-aids-s2", "no-semester"]);
  });
  it("a course with no semester concept shows every semester", () => {
    const ids = assignmentsForFilter(rows, { ...base, semester: null, departmentNames: null }).map((r) => r.id);
    expect(ids).toEqual(["fy-aids-s1", "fy-cse-s1", "fy-aids-s2", "no-semester", "legacy-bsm"]);
  });
  it("never alters or drops the source list", () => {
    const before = rows.map((r) => r.id);
    assignmentsForFilter(rows, { ...base, departmentNames: new Set(["Nope"]) });
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
