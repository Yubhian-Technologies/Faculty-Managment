import { describe, it, expect } from "vitest";
import { sectionsOfDepartment } from "@/lib/departments/departmentSections";
import type { Department } from "@/types";

// Live shape (VIT): sections are filed under the real branch for EVERY year; the Basic Science sub-departments
// only manage the branches for the shared first year.
const CAT = "btech";
const scope = (years: number[]) => ({ [CAT]: { assignedYears: years, secondaryDepartments: [] as string[] } });
const D = (id: string, name: string, x: Record<string, unknown> = {}) =>
  ({ id, name, code: name.slice(0, 3).toUpperCase(), isActive: true, ...x }) as unknown as Department;
const departments: Department[] = [
  D("bs", "Basic Science", { hasSubDepartments: true, parentRunsOwnSections: true, courseScopes: scope([1]) }),
  D("chem", "BS Chemistry", { parentDepartmentId: "bs", managedDepartments: ["CSE", "CSBS"] }),
  D("phy", "BS Physics", { parentDepartmentId: "bs", managedDepartments: ["IT"] }),
  D("cse", "CSE", { courseScopes: scope([2, 3, 4]) }),
  D("csbs", "CSBS", { courseScopes: scope([2, 3, 4]) }),
  D("it", "IT", { courseScopes: scope([2, 3, 4]) }),
];
const sec = (id: string, department: string, year: number, courseId = "c1") => ({ id, department, year, courseId, departmentId: departments.find((d) => d.name === department)?.id });
const sections = [
  sec("cse1a", "CSE", 1), sec("cse1b", "CSE", 1), sec("cse2a", "CSE", 2), sec("cse4a", "CSE", 4),
  sec("csbs1a", "CSBS", 1), sec("csbs3a", "CSBS", 3),
  sec("it1a", "IT", 1), sec("it2a", "IT", 2),
];
const cat = new Map([["c1", CAT]]);
const ids = (name: string) => sectionsOfDepartment(departments.find((d) => d.name === name)!, departments, sections, cat).map((s) => s.id).sort();

describe("sectionsOfDepartment (Principal Departments drill-down)", () => {
  it("a shared-year manager lists the first-year sections of the branches it manages, and only those", () => {
    expect(ids("BS Chemistry")).toEqual(["csbs1a", "cse1a", "cse1b"]);
    expect(ids("BS Physics")).toEqual(["it1a"]);
  });

  it("a branch keeps its full roster, every year, and never gains another branch's", () => {
    expect(ids("CSE")).toEqual(["cse1a", "cse1b", "cse2a", "cse4a"]);
    expect(ids("IT")).toEqual(["it1a", "it2a"]);
  });

  it("every section is reachable from its own branch (nothing dropped)", () => {
    const seen = new Set(["CSE", "CSBS", "IT"].flatMap(ids));
    for (const s of sections) expect(seen.has(s.id)).toBe(true);
  });

  it("a plain department with no manager behaves as the plain name match", () => {
    const plain = [D("a", "A", { courseScopes: scope([1, 2]) }), D("b", "B", { courseScopes: scope([1, 2]) })];
    const own = [sec("a1", "A", 1), sec("b1", "B", 1)];
    expect(sectionsOfDepartment(plain[0], plain, own, cat).map((s) => s.id)).toEqual(["a1"]);
  });

  it("follows the configured years, not a fixed year 1 (manager shares years 1-2)", () => {
    const wide = departments.map((d) => (d.id === "bs" ? D("bs", "Basic Science", { hasSubDepartments: true, courseScopes: scope([1, 2]) }) : d.id === "cse" ? D("cse", "CSE", { courseScopes: scope([3, 4]) }) : d));
    const got = sectionsOfDepartment(wide.find((d) => d.id === "chem")!, wide, sections, cat).map((s) => s.id).sort();
    expect(got).toEqual(["csbs1a", "cse1a", "cse1b", "cse2a"]);
  });

  it("a manager's years are decided per course (another course it does not teach is not listed)", () => {
    const mixed = [...sections, sec("cse1m", "CSE", 1, "c2")];
    const got = sectionsOfDepartment(departments.find((d) => d.id === "chem")!, departments, mixed, new Map([["c1", CAT], ["c2", "mtech"]])).map((s) => s.id);
    expect(got).not.toContain("cse1m");
  });
});
