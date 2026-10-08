import { beforeAll, describe, expect, it } from "vitest";
import { fakeStudentsCollection, type FakeStudent } from "@/lib/students/fakeStudentsCollection.testutil";
import {
  fetchHodStudentsPage,
  type HodListFilters,
  type HodStudentsContext,
} from "@/lib/students/hodPagedList";
import { rollupDepartmentNames, coreDepartmentOptions, departmentFilterOptions } from "@/lib/departments/departmentTree";
import type { HodDepartmentScope } from "@/lib/departments/scope";
import type { DepartmentYearRow } from "@/lib/departments/managedBranches";
import type { Department } from "@/types";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

/**
 * What each KIND of HOD sees on the Students page - the same college, one roster,
 * every persona. The scope arrays are built the way getHodDepartmentScope builds
 * them (own / sub-departments / managed branches, with a managed branch that holds
 * no sections swapped for its sub-branches).
 */
type D = DepartmentYearRow & Partial<Pick<Department, "hasSubDepartments" | "parentRunsOwnSections" | "isActive">>;
const D = (d: D): D => ({ isActive: true, ...d });

const departments: D[] = [
  // VIT shape
  D({ id: "bs", name: "Basic Science", hasSubDepartments: true, assignedYears: [1] }),
  D({ id: "bsm", name: "BS-Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS"] }),
  D({ id: "bsp", name: "BS-Physics", parentDepartmentId: "bs", managedDepartments: ["CSE"] }),
  D({ id: "aids", name: "AIDS", assignedYears: [2, 3, 4] }),
  D({ id: "cse", name: "CSE", assignedYears: [2, 3, 4] }),
  // Women's-university shape: a core that runs sections and has a sub-department that does
  D({ id: "ece", name: "ECE", hasSubDepartments: true, assignedYears: [2, 3, 4] }),
  D({ id: "vlsi", name: "VLSI", parentDepartmentId: "ece", assignedYears: [2, 3, 4] }),
  // ...and a core with no sections of its own, split into sub-branches
  D({ id: "ai", name: "AI", hasSubDepartments: true, parentRunsOwnSections: false }),
  D({ id: "ai1", name: "AIML", parentDepartmentId: "ai", assignedYears: [2, 3, 4] }),
  D({ id: "ai2", name: "AIDS2", parentDepartmentId: "ai", assignedYears: [2, 3, 4] }),
];

const stu = (id: string, data: Record<string, unknown>): FakeStudent => ({ id, data: { name: id, section: "A", ...data } });
const roster: FakeStudent[] = [
  // first years: filed under the sub-department, branch recorded as Core Department
  stu("fy-aids", { department: "BS-Maths", secondaryDepartment: "AIDS", year: 1, rollNumber: "1" }),
  stu("fy-cse", { department: "BS-Physics", secondaryDepartment: "CSE", year: 1, rollNumber: "2" }),
  // later years: filed under the branch itself
  stu("aids-2", { department: "AIDS", year: 2, rollNumber: "3" }),
  stu("cse-3", { department: "CSE", year: 3, rollNumber: "4" }),
  stu("ece-3", { department: "ECE", year: 3, rollNumber: "5" }),
  stu("vlsi-3", { department: "VLSI", year: 3, rollNumber: "6" }),
  stu("aiml-2", { department: "AIML", year: 2, rollNumber: "7" }),
  stu("aids2-2", { department: "AIDS2", year: 2, rollNumber: "8" }),
];

function ctxFor(own: string[], child: string[], managed: string[]): HodStudentsContext {
  const deptIdByName = new Map(departments.map((d) => [d.name as string, d.id]));
  return {
    scope: {
      departmentName: own[0], departmentId: null,
      ownDepartmentNames: own, ownDepartmentIds: [],
      childDepartmentNames: child, childDepartmentIds: [],
      managedDepartmentNames: managed, managedDepartmentIds: [],
    } as unknown as HodDepartmentScope,
    departments, courses: [], deptIdByName,
    ownedDeptNames: [...child, ...managed],
    secondaryTargets: Array.from(new Set([...own, ...child])),
  };
}

const filters = (over: Partial<HodListFilters> = {}): HodListFilters => ({
  level: "primary", freshmanDept: "", departmentNames: null, course: "", year: null, unassignedOnly: false, ...over,
});
const opts = { page: 1, pageSize: 50, search: "", binding: "b" };
const ids = async (ctx: HodStudentsContext, f: HodListFilters) =>
  (await fetchHodStudentsPage(fakeStudentsCollection(roster).collection, ctx, f, opts)).students.map((s) => s.id).sort();

describe("the parent's HOD (Basic Science)", () => {
  const ctx = ctxFor(["Basic Science"], ["BS-Maths", "BS-Physics"], ["AIDS", "CSE"]);

  it("sees every first year of every branch it runs, and none of the branches' later years", async () => {
    expect(await ids(ctx, filters())).toEqual(["fy-aids", "fy-cse"]);
  });

  it("picking the parent itself (all sub-departments) gives the same, not nothing", async () => {
    const names = rollupDepartmentNames(departments as Department[], "Basic Science", false);
    expect(await ids(ctx, filters({ departmentNames: names }))).toEqual(["fy-aids", "fy-cse"]);
  });

  it("one Core Department pick reaches that branch's first years across every sub-department", async () => {
    expect(await ids(ctx, filters({ coreDepartment: "AIDS" }))).toEqual(["fy-aids"]);
    expect(await ids(ctx, filters({ coreDepartment: "CSE" }))).toEqual(["fy-cse"]);
  });

  // Why a managed branch is no longer a Department option: its first years are not
  // filed under it, and its later years belong to its own HOD - so it could only
  // ever come back empty.
  it("a managed branch picked as a Department can only come back empty", async () => {
    expect(await ids(ctx, filters({ departmentNames: ["AIDS"] }))).toEqual([]);
  });

  it("offers the managed branches as Core Departments instead, at the All level too", () => {
    const sections = ["AIDS", "CSE"];
    expect(coreDepartmentOptions(departments as Department[], ["BS-Maths", "BS-Physics"], sections)).toEqual(["AIDS", "CSE"]);
    expect(coreDepartmentOptions(departments as Department[], ["Basic Science"], sections)).toEqual(["AIDS", "CSE"]);
  });
});

describe("a sub-department's HOD (BS-Maths)", () => {
  const ctx = ctxFor(["BS-Maths"], [], ["AIDS"]);
  it("sees the first years filed under it, and its Core Department narrows them", async () => {
    expect(await ids(ctx, filters())).toEqual(["fy-aids"]);
    expect(await ids(ctx, filters({ coreDepartment: "AIDS" }))).toEqual(["fy-aids"]);
    expect(await ids(ctx, filters({ coreDepartment: "CSE" }))).toEqual([]);
  });
});

describe("a branch's own HOD (AIDS)", () => {
  const ctx = ctxFor(["AIDS"], [], []);
  it("owns its later years; the first years the manager holds for it are incoming, view-only", async () => {
    expect(await ids(ctx, filters())).toEqual(["aids-2"]);
    const incoming = await fetchHodStudentsPage(
      fakeStudentsCollection(roster).collection, ctx, filters({ level: "secondary", freshmanDept: "BS-Maths" }), opts
    );
    expect(incoming.students.map((s) => s.id)).toEqual(["fy-aids"]);
  });
});

describe("a core that runs sections and has a sub-department that does (ECE -> VLSI)", () => {
  const ctx = ctxFor(["ECE"], ["VLSI"], []);
  it("sees both, and picking ECE still means ECE only - nothing that worked changes", async () => {
    expect(await ids(ctx, filters())).toEqual(["ece-3", "vlsi-3"]);
    const names = rollupDepartmentNames(departments as Department[], "ECE", true);
    expect(names).toEqual(["ECE"]);
    expect(await ids(ctx, filters({ departmentNames: names }))).toEqual(["ece-3"]);
    expect(await ids(ctx, filters({ departmentNames: ["VLSI"] }))).toEqual(["vlsi-3"]);
  });
  it("lists VLSI indented under ECE in the Department dropdown", () => {
    const opts = departmentFilterOptions(departments.filter((d) => ["ECE", "VLSI"].includes(d.name as string)) as Department[], departments as Department[], ["ECE", "VLSI"]);
    expect(opts.map((o) => `${o.depth}:${o.department.name}`)).toEqual(["0:ECE", "1:VLSI"]);
  });
});

describe("a core that holds no sections itself (AI -> AIML, AIDS2)", () => {
  const ctx = ctxFor(["AI"], ["AIML", "AIDS2"], []);
  it("sees the students of both sub-branches, and picking AI rolls up to them", async () => {
    expect(await ids(ctx, filters())).toEqual(["aids2-2", "aiml-2"]);
    const names = rollupDepartmentNames(departments as Department[], "AI");
    expect(names).toEqual(["AI", "AIML", "AIDS2"]);
    expect(await ids(ctx, filters({ departmentNames: names }))).toEqual(["aids2-2", "aiml-2"]);
  });
});
