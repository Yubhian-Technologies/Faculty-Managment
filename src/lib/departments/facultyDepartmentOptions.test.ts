import { describe, expect, it } from "vitest";
import { facultyDepartmentOptions, isFacultyDestination, type FacultyDepartmentLike } from "./facultyDepartmentOptions";

// "This department also has its own sections/students" (parentRunsOwnSections)
// OFF means the department only ORGANISES its sub-departments - its students,
// sections and therefore its faculty live in them. It was still being offered
// as a place to file a faculty member.

const dept = (id: string, name: string, extra: Partial<FacultyDepartmentLike> = {}): FacultyDepartmentLike =>
  ({ id, name, code: name.toUpperCase().slice(0, 4), ...extra });

// AI organises DS and ML and runs nothing itself; CSE is a plain department.
const AI = dept("ai", "Artificial Intelligence", { hasSubDepartments: true, parentRunsOwnSections: false });
const DS = dept("ds", "data science", { parentDepartmentId: "ai" });
const ML = dept("ml", "machine learning", { parentDepartmentId: "ai" });
const CSE = dept("cse", "Computer Science and Engineering");
// A parent that teaches its own classes AS WELL as having sub-departments.
const ECE = dept("ece", "Electronics", { hasSubDepartments: true, parentRunsOwnSections: true });
const VLSI = dept("vlsi", "vlsi", { parentDepartmentId: "ece" });

const ALL = [AI, DS, ML, CSE, ECE, VLSI];

describe("isFacultyDestination", () => {
  it("rejects a parent that organises sub-departments and runs none of its own", () => {
    expect(isFacultyDestination(AI, ALL)).toBe(false);
  });

  it("accepts a parent that runs its own sections too", () => {
    expect(isFacultyDestination(ECE, ALL)).toBe(true);
  });

  it("accepts the sub-departments themselves", () => {
    expect(isFacultyDestination(DS, ALL)).toBe(true);
    expect(isFacultyDestination(ML, ALL)).toBe(true);
  });

  it("accepts an ordinary department", () => {
    expect(isFacultyDestination(CSE, ALL)).toBe(true);
  });

  // The guard that stops this emptying a picker: a parent with the toggle off
  // but nothing beneath it yet is still the only place to put anyone.
  it("accepts a childless parent even with the toggle off", () => {
    const lonely = dept("x", "New Dept", { hasSubDepartments: true, parentRunsOwnSections: false });
    expect(isFacultyDestination(lonely, [lonely, CSE])).toBe(true);
  });

  // Legacy docs predate the flag; absent must not mean "not a destination".
  it("accepts a department with the flag absent", () => {
    expect(isFacultyDestination(dept("y", "Legacy", { hasSubDepartments: true }), ALL)).toBe(true);
  });
});

describe("facultyDepartmentOptions", () => {
  it("offers the sub-departments but not the parent that organises them", () => {
    const names = facultyDepartmentOptions(ALL, ["Artificial Intelligence"]).map((d) => d.name);
    expect(names).toEqual(["data science", "machine learning"]);
    expect(names).not.toContain("Artificial Intelligence");
  });

  it("still offers a parent that runs its own sections, alongside its children", () => {
    expect(facultyDepartmentOptions(ALL, ["Electronics"]).map((d) => d.name)).toEqual(["Electronics", "vlsi"]);
  });

  it("leaves an ordinary department alone", () => {
    expect(facultyDepartmentOptions(ALL, ["Computer Science and Engineering"]).map((d) => d.name))
      .toEqual(["Computer Science and Engineering"]);
  });

  // An HOD heading both kinds keeps everything they can really use.
  it("drops only the organising parent for a multi-department HOD", () => {
    const names = facultyDepartmentOptions(ALL, ["Artificial Intelligence", "Computer Science and Engineering"]).map((d) => d.name);
    expect(names).toEqual(["Computer Science and Engineering", "data science", "machine learning"]);
  });

  it("never leaves a parent HOD with nowhere to file anyone", () => {
    const lonely = dept("x", "New Dept", { hasSubDepartments: true, parentRunsOwnSections: false });
    expect(facultyDepartmentOptions([lonely], ["New Dept"]).map((d) => d.name)).toEqual(["New Dept"]);
  });
});
