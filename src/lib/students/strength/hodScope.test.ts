import { describe, expect, it } from "vitest";
import type { HodDepartmentScope } from "@/lib/departments/scope";
import type { Course } from "@/types";
import { filterRowsForHod } from "./hodScope";
import type { StrengthRow } from "./types";

const scope = (over: Partial<HodDepartmentScope>): HodDepartmentScope => ({
  departmentName: over.ownDepartmentNames?.[0] ?? "",
  departmentId: null,
  ownDepartmentNames: [],
  ownDepartmentIds: [],
  childDepartmentNames: [],
  childDepartmentIds: [],
  managedDepartmentNames: [],
  managedDepartmentIds: [],
  ...over,
});

// CSE's shared first year is run by the Basic Science - Maths sub-department.
const departments = [
  { id: "bsm", name: "Basic Science-Maths", managedDepartments: ["CSE"], assignedYears: [1] },
  { id: "cse", name: "CSE", assignedYears: [2, 3, 4] },
  { id: "it", name: "IT", assignedYears: [1, 2, 3, 4] },
];
const courses = [] as Course[];

let n = 0;
const row = (over: Partial<StrengthRow>): StrengthRow => ({ id: `r${++n}`, department: "CSE", year: 2, course: "B.Tech", section: "A", status: "REGULAR", ...over });

const rows = {
  cse2: row({ department: "CSE", year: 2 }),
  cse3: row({ department: "CSE", year: 3 }),
  cse1Filed: row({ department: "CSE", year: 1 }), // year 1 of CSE belongs to the manager
  it2: row({ department: "IT", year: 2 }),
  freshCse: row({ department: "Basic Science-Maths", secondaryDepartment: "CSE", year: 1 }),
  freshIt: row({ department: "Basic Science-Maths", secondaryDepartment: "IT", year: 1 }),
};
const all = Object.values(rows);
const ids = (rs: StrengthRow[]) => rs.map((r) => r.id).sort();

describe("filterRowsForHod", () => {
  it("a plain department HOD sees their own years plus fresh-year students pre-registered to them, nobody else", () => {
    const seen = filterRowsForHod(all, scope({ ownDepartmentNames: ["CSE"] }), departments, courses);
    // CSE year 1 is owned by the Basic Science manager, so it is NOT the CSE HOD's.
    expect(ids(seen)).toEqual(ids([rows.cse2, rows.cse3, rows.freshCse]));
  });

  it("the sub-HOD who runs the shared first year sees the branch's first-years, never its other years", () => {
    const seen = filterRowsForHod(all, scope({ ownDepartmentNames: ["Basic Science-Maths"], managedDepartmentNames: ["CSE"] }), departments, courses);
    expect(ids(seen)).toEqual(ids([rows.cse1Filed, rows.freshCse, rows.freshIt]));
  });

  it("a parent HOD also sees students filed under their sub-departments", () => {
    const seen = filterRowsForHod(all, scope({ ownDepartmentNames: ["IT"], childDepartmentNames: ["Basic Science-Maths"] }), departments, courses);
    expect(ids(seen)).toEqual(ids([rows.it2, rows.freshCse, rows.freshIt]));
  });

  it("an HOD with no department on file sees nothing - not the whole college", () => {
    expect(filterRowsForHod(all, scope({}), departments, courses)).toEqual([]);
  });

  it("never returns a student twice", () => {
    const seen = filterRowsForHod(all, scope({ ownDepartmentNames: ["CSE", "IT"], childDepartmentNames: ["Basic Science-Maths"] }), departments, courses);
    expect(new Set(ids(seen)).size).toBe(seen.length);
  });
});
