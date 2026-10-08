import { describe, expect, it } from "vitest";
import type { Course, Department } from "@/types";
import { courseForDepartmentPick, timetableDepartmentOptions, yearsForDepartmentPick } from "./timetablePick";

const CAT = "btech";
const scope = (years: number[]) => ({ [CAT]: { assignedYears: years, secondaryDepartments: [] } });
const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;
const course = (id: string, departmentId: string, name = "Bachelor of Technology"): Course =>
  ({ id, departmentId, name, catalogId: CAT, durationYears: 4 }) as Course;

// VIT: Basic Science (parent) -> BS-Maths / BS-Physics (sub-departments, no Course doc) -> manage branches (year 1).
const BS = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true, courseScopes: scope([1]) });
const BSM = dept({ id: "bsm", name: "BS-Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS", "AIML"] });
const BSP = dept({ id: "bsp", name: "BS-Physics", parentDepartmentId: "bs", managedDepartments: ["CSE"] });
const AIDS = dept({ id: "aids", name: "AIDS", courseScopes: scope([2, 3, 4]) });
const AIML = dept({ id: "aiml", name: "AIML", courseScopes: scope([2, 3, 4]) });
const CSE = dept({ id: "cse", name: "CSE", courseScopes: scope([2, 3, 4]) });
// VWU: AI holds nothing and is split into two branches that hold the real sections.
const AI = dept({ id: "ai", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false });
const CAI = dept({ id: "cai", name: "CSE [AI&ML]", parentDepartmentId: "ai", courseScopes: scope([2, 3, 4]) });
const CAD = dept({ id: "cad", name: "CSE [AI&DS]", parentDepartmentId: "ai", courseScopes: scope([2, 3, 4]) });
const ECE = dept({ id: "ece", name: "ECE", hasSubDepartments: true, courseScopes: scope([2, 3, 4]) });
const VLSI = dept({ id: "vlsi", name: "VLSI", parentDepartmentId: "ece", courseScopes: scope([2, 3, 4]) });
const ALL = [BS, BSM, BSP, AIDS, AIML, CSE, AI, CAI, CAD, ECE, VLSI];

// Only departments that own a Course doc: the sub-departments of Basic Science own none; AI's branches own theirs.
const COURSES = [course("c-bs", "bs"), course("c-aids", "aids"), course("c-aiml", "aiml"), course("c-cse", "cse"),
  course("c-cai", "cai"), course("c-cad", "cad"), course("c-ece", "ece"), course("c-vlsi", "vlsi"),
  course("c-mtech", "cse", "Master of Technology")];

const label = (o: ReturnType<typeof timetableDepartmentOptions>[number]) => `${o.depth}:${o.department.name}${o.coversSubDepartments ? "*" : ""}`;

describe("timetableDepartmentOptions", () => {
  const opts = timetableDepartmentOptions(ALL, COURSES, "Bachelor of Technology");
  it("keeps every department the old list had (the ones owning a Course doc)", () => {
    const names = opts.map((o) => o.department.name);
    for (const c of COURSES.filter((c) => c.name === "Bachelor of Technology")) {
      expect(names).toContain(ALL.find((d) => d.id === c.departmentId)!.name);
    }
  });
  it("adds the sub-departments, so BS-Maths and BS-Physics can be picked, indented under Basic Science", () => {
    const l = opts.map(label);
    expect(l.indexOf("1:BS-Maths")).toBe(l.indexOf("0:Basic Science*") + 1);
    expect(l).toContain("1:BS-Physics");
  });
  it("lists a split-up core with its branches beneath it, and each branch on its own", () => {
    const l = opts.map(label);
    expect(l).toContain("0:AI*");
    expect(l).toContain("1:CSE [AI&ML]");
    expect(l).toContain("1:CSE [AI&DS]");
  });
  it("lists a parent that runs sections with its sub-department indented beneath it", () => {
    const l = opts.map(label);
    expect(l.indexOf("1:VLSI")).toBe(l.indexOf("0:ECE*") + 1);
  });
  it("a parent whose sub-departments offer the programme is offered even if it owns no Course doc", () => {
    const names = timetableDepartmentOptions(ALL, COURSES.filter((c) => c.departmentId !== "ai"), "Bachelor of Technology").map((o) => o.department.name);
    expect(names).toContain("AI");
  });
  it("only a department that offers the programme appears; no course, no options", () => {
    const m = timetableDepartmentOptions(ALL, COURSES, "Master of Technology").map((o) => o.department.name);
    expect(m).toEqual(["CSE"]);
    expect(timetableDepartmentOptions(ALL, COURSES, "")).toEqual([]);
  });
  it("keeps an inactive department, as the old list did", () => {
    const retired = dept({ id: "r", name: "Retired", isActive: false });
    const o = timetableDepartmentOptions([...ALL, retired], [...COURSES, course("c-r", "r")], "Bachelor of Technology");
    expect(o.map((x) => x.department.name)).toContain("Retired");
  });
});

describe("courseForDepartmentPick", () => {
  const forPick = (id: string) => courseForDepartmentPick(COURSES, ALL, "Bachelor of Technology", id)?.id;
  it("a department that owns a Course doc resolves to it (unchanged)", () => {
    expect(forPick("aids")).toBe("c-aids");
    expect(forPick("bs")).toBe("c-bs");
  });
  it("a sub-department shares its parent's", () => {
    expect(forPick("bsm")).toBe("c-bs");
    expect(forPick("bsp")).toBe("c-bs");
  });
  it("a parent with no Course doc of its own uses one of its sub-departments'", () => {
    expect(courseForDepartmentPick(COURSES.filter((c) => c.id !== "c-ai"), ALL, "Bachelor of Technology", "ai")?.id).toMatch(/^c-(cai|cad)$/);
  });
  it("nothing for an unknown department or a programme it does not offer", () => {
    expect(forPick("nope")).toBeUndefined();
    expect(courseForDepartmentPick(COURSES, ALL, "Master of Technology", "aids")).toBeNull();
  });
});

describe("yearsForDepartmentPick", () => {
  const c = { durationYears: 4, catalogId: CAT };
  it("is what it was for a department with years of its own", () => {
    expect(yearsForDepartmentPick(ALL, c, "bs")).toEqual([1]);
    expect(yearsForDepartmentPick(ALL, c, "ece")).toEqual([2, 3, 4]);
  });
  it("a sub-department inherits its parent's", () => {
    expect(yearsForDepartmentPick(ALL, c, "bsm")).toEqual([1]);
  });
  it("a branch also offers the year its manager teaches for it (view only)", () => {
    expect(yearsForDepartmentPick(ALL, c, "aids")).toEqual([1, 2, 3, 4]);
    expect(yearsForDepartmentPick(ALL, c, "cse")).toEqual([1, 2, 3, 4]);
  });
  it("a parent with no years of its own offers its sub-departments' (AI -> its two branches)", () => {
    expect(yearsForDepartmentPick(ALL, c, "ai")).toEqual([2, 3, 4]);
    expect(yearsForDepartmentPick(ALL, c, "cai")).toEqual([2, 3, 4]);
  });
  it("unconfigured stays empty - never every year of the course", () => {
    const blank = dept({ id: "z", name: "Z" });
    expect(yearsForDepartmentPick([...ALL, blank], c, "z")).toEqual([]);
    expect(yearsForDepartmentPick(ALL, c, "nope")).toEqual([]);
  });
  it("never offers a year beyond the course", () => {
    expect(yearsForDepartmentPick(ALL, { durationYears: 2, catalogId: CAT }, "ece")).toEqual([2]);
  });
});
