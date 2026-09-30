import { describe, it, expect } from "vitest";
import { classifySectionForHod } from "@/lib/departments/managedBranches";
import { sectionMatchesDepartmentFilter } from "@/lib/departments/hodScope";
import type { Department } from "@/types";

// Shape of the live shared-first-year college: Basic Science teaches B.Tech
// year 1 only; its sub-departments manage the branches for that year; every
// branch teaches years 2-4 itself. Sections are filed under the BRANCH name for
// every year, so who sees a given (branch, year) is purely a read-time rule.
const CAT = "btech";
const D = (id: string, name: string, x: Record<string, unknown> = {}) =>
  ({ id, name, code: name.slice(0, 3).toUpperCase(), isActive: true, ...x }) as unknown as Department;
const branch = (id: string, name: string, x: Record<string, unknown> = {}) =>
  D(id, name, { courseScopes: { [CAT]: { assignedYears: [2, 3, 4] } }, ...x });

const departments: Department[] = [
  D("bs", "Basic Science", { hasSubDepartments: true, parentRunsOwnSections: true, courseScopes: { [CAT]: { assignedYears: [1] } } }),
  D("eng", "BS English", { parentDepartmentId: "bs", managedDepartments: ["Civil", "Mech"] }),
  D("chem", "BS Chemistry", { parentDepartmentId: "bs", managedDepartments: ["CSE", "CSBS"] }),
  D("phy", "BS Physics", { parentDepartmentId: "bs", managedDepartments: ["IT"] }),
  branch("civil", "Civil"),
  branch("mech", "Mech"),
  branch("cse", "CSE"),
  branch("csbs", "CSBS"),
  branch("it", "IT"),
];

const bsMain = { ownDepartmentNames: ["Basic Science"], childDepartmentNames: ["BS English", "BS Chemistry", "BS Physics"] };
const chemSub = { ownDepartmentNames: ["BS Chemistry"], childDepartmentNames: [] as string[] };
const itHod = { ownDepartmentNames: ["IT"], childDepartmentNames: [] as string[] };

describe("classifySectionForHod (HOD list, managed-branch query)", () => {
  it("main BS HOD: branch year 1 is theirs, years 2-4 are not shown at all", () => {
    for (const b of ["Civil", "Mech", "CSE", "CSBS", "IT"]) {
      expect(classifySectionForHod(bsMain, departments, b, 1, CAT)).toBe("primary");
      for (const y of [2, 3, 4]) expect(classifySectionForHod(bsMain, departments, b, y, CAT)).toBe("hidden");
    }
  });

  it("BS sub-HOD: year 1 of the branches it manages only", () => {
    expect(classifySectionForHod(chemSub, departments, "CSE", 1, CAT)).toBe("primary");
    expect(classifySectionForHod(chemSub, departments, "CSBS", 1, CAT)).toBe("primary");
    for (const y of [2, 3, 4]) {
      expect(classifySectionForHod(chemSub, departments, "CSE", y, CAT)).toBe("hidden");
      expect(classifySectionForHod(chemSub, departments, "CSBS", y, CAT)).toBe("hidden");
    }
  });

  it("a true parent keeps its child's year 1 read-only, and years 2-4 are theirs", () => {
    const withChild: Department[] = [
      ...departments,
      D("ai", "AI", { hasSubDepartments: true, courseScopes: { [CAT]: { assignedYears: [2, 3, 4] } } }),
      branch("ds", "Data Science", { parentDepartmentId: "ai" }),
      D("eng2", "BS Extra", { parentDepartmentId: "bs", managedDepartments: ["Data Science"] }),
    ];
    const aiHod = { ownDepartmentNames: ["AI"], childDepartmentNames: ["Data Science"] };
    expect(classifySectionForHod(aiHod, withChild, "Data Science", 1, CAT)).toBe("secondary");
    for (const y of [2, 3, 4]) expect(classifySectionForHod(aiHod, withChild, "Data Science", y, CAT)).toBe("primary");
  });

  it("a branch HOD's own department: years 2-4 primary (year 1 is the manager's)", () => {
    for (const y of [2, 3, 4]) expect(classifySectionForHod(itHod, departments, "IT", y, CAT)).toBe("primary");
    expect(classifySectionForHod(itHod, departments, "IT", 1, CAT)).not.toBe("primary");
  });
});

describe("sectionMatchesDepartmentFilter (college-wide Sections)", () => {
  const match = (filter: string, dept: string, year: number) =>
    sectionMatchesDepartmentFilter(departments, filter, dept, year, CAT);

  it("Basic Science -> year 1 of every branch, never years 2-4", () => {
    for (const b of ["Civil", "Mech", "CSE", "CSBS", "IT"]) {
      expect(match("Basic Science", b, 1)).toBe(true);
      for (const y of [2, 3, 4]) expect(match("Basic Science", b, y)).toBe(false);
    }
  });

  it("a BS sub-department -> year 1 of only the branches it manages", () => {
    expect(match("BS Chemistry", "CSE", 1)).toBe(true);
    expect(match("BS Chemistry", "CSBS", 1)).toBe(true);
    expect(match("BS Chemistry", "IT", 1)).toBe(false);
    expect(match("BS Chemistry", "CSE", 2)).toBe(false);
  });

  it("a branch -> its full roster, all years, and nobody else's", () => {
    for (const y of [1, 2, 3, 4]) expect(match("IT", "IT", y)).toBe(true);
    expect(match("IT", "CSE", 1)).toBe(false);
    expect(match("IT", "CSE", 3)).toBe(false);
  });

  it("no managing department -> plain name match, unchanged", () => {
    const plain = [branch("a", "A"), branch("b", "B")];
    expect(sectionMatchesDepartmentFilter(plain, "A", "A", 3, CAT)).toBe(true);
    expect(sectionMatchesDepartmentFilter(plain, "A", "B", 3, CAT)).toBe(false);
  });

  it("across the whole college every section stays reachable from its own branch", () => {
    const all = ["Civil", "Mech", "CSE", "CSBS", "IT"].flatMap((b) => [1, 2, 3, 4].map((y) => ({ b, y })));
    for (const s of all) expect(match(s.b, s.b, s.y)).toBe(true);
  });
});
