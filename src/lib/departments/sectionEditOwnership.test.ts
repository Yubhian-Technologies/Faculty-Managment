import { describe, it, expect } from "vitest";
import { canHodEditDepartmentYear, canHodExclusivelyOwnDepartmentYear, resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";

// Who may EDIT a section, as api/college/sections/[id] decides it.
//
// The rule has two clauses and both matter: a true sub-department is owned
// outright regardless of year, and only a MANAGED branch is year-scoped (the
// manager owns the shared year, the branch's own HOD owns the rest). PATCH and
// DELETE used to re-derive only the second clause inline, so editing failed on
// sections that creating and listing both allowed.

type Row = DepartmentYearRow & { name?: string; hasSubDepartments?: boolean; parentRunsOwnSections?: boolean };
const D = (name: string, id: string, x: Record<string, unknown> = {}) => ({ id, name, ...x }) as Row;

const CAT = "btech";
// BASIC SCIENCE runs the shared first year through BS-ENGLISH, which groups
// AI. AI itself runs no sections, so its students sit in AIML / AIDS.
const depts: Row[] = [
  D("BASIC SCIENCE", "bs", { hasSubDepartments: true, parentRunsOwnSections: false }),
  D("BS-ENGLISH", "bse", { parentDepartmentId: "bs", managedDepartments: ["AI", "IT"], courseScopes: { [CAT]: { assignedYears: [1] } } }),
  D("AI", "ai", { hasSubDepartments: true, parentRunsOwnSections: false }),
  D("AIML", "aiml", { parentDepartmentId: "ai" }),
  D("AIDS", "aids", { parentDepartmentId: "ai" }),
  D("IT", "it", { courseScopes: { [CAT]: { assignedYears: [2, 3, 4] } } }),
];

const scope = (own: string[], child: string[] = [], managed: string[] = []) =>
  ({ ownDepartmentNames: own, childDepartmentNames: child, managedDepartmentNames: managed });

const aiHod = scope(["AI"], ["AIML", "AIDS"]);
const bsHod = scope(["BASIC SCIENCE"], ["BS-ENGLISH"], ["AI", "IT", "AIML", "AIDS"]);
const itHod = scope(["IT"]);

describe("section edit ownership", () => {
  it("lets an HOD edit a section in their own sub-department, whatever the year", () => {
    // The regression: the year-owner here is BS-ENGLISH (it groups this
    // sub-department's parent and teaches year 1), which is not one of the AI
    // HOD's own or child departments - so the old inline check refused, even
    // though POST allowed creating it and GET listed it with full access.
    expect(resolveBranchYearOwner(depts, "AIDS", 1, CAT)).toBe("BS-ENGLISH");
    expect(canHodEditDepartmentYear(aiHod, depts, "AIDS", 1, CAT)).toBe(true);
    expect(canHodEditDepartmentYear(aiHod, depts, "AIML", 1, CAT)).toBe(true);
    expect(canHodEditDepartmentYear(aiHod, depts, "AIDS", 2, CAT)).toBe(true);
  });

  it("still lets the shared-year manager edit the year it actually runs", () => {
    expect(canHodEditDepartmentYear(bsHod, depts, "IT", 1, CAT)).toBe(true);
  });

  it("still keeps a managed branch's later years away from the manager", () => {
    // Year 2 belongs to IT's own HOD - the manager only runs the shared year.
    expect(canHodEditDepartmentYear(bsHod, depts, "IT", 2, CAT)).toBe(false);
  });

  it("still keeps the shared year away from the branch's own HOD", () => {
    expect(canHodEditDepartmentYear(itHod, depts, "IT", 1, CAT)).toBe(false);
    expect(canHodEditDepartmentYear(itHod, depts, "IT", 3, CAT)).toBe(true);
  });

  it("still refuses a department outside the HOD's tree entirely", () => {
    expect(canHodEditDepartmentYear(itHod, depts, "AIML", 1, CAT)).toBe(false);
    expect(canHodEditDepartmentYear(aiHod, depts, "IT", 2, CAT)).toBe(false);
  });
});

describe("section edit ownership - Sections-only exclusive variant", () => {
  // canHodExclusivelyOwnDepartmentYear is Sections' own stricter gate (GET's
  // accessLevel tag and PATCH/DELETE) - unlike canHodEditDepartmentYear above
  // (which Teaching Assignments/Students keep relying on), a true child whose
  // year is claimed by a DIFFERENT department's managedDepartments loses
  // exclusive ownership of that year to the manager instead of keeping it
  // unconditionally.
  it("denies the branch's own permanent HOD the shared year a different department manages", () => {
    expect(canHodExclusivelyOwnDepartmentYear(aiHod, depts, "AIDS", 1, CAT)).toBe(false);
    expect(canHodExclusivelyOwnDepartmentYear(aiHod, depts, "AIML", 1, CAT)).toBe(false);
  });

  it("still lets the branch's own permanent HOD edit the years nobody else manages", () => {
    expect(canHodExclusivelyOwnDepartmentYear(aiHod, depts, "AIDS", 2, CAT)).toBe(true);
  });

  it("still lets the shared-year manager edit the year it actually runs", () => {
    expect(canHodExclusivelyOwnDepartmentYear(bsHod, depts, "IT", 1, CAT)).toBe(true);
  });

  it("still keeps a managed branch's later years away from the manager", () => {
    expect(canHodExclusivelyOwnDepartmentYear(bsHod, depts, "IT", 2, CAT)).toBe(false);
  });

  it("still keeps the shared year away from the branch's own HOD, and later years with them", () => {
    expect(canHodExclusivelyOwnDepartmentYear(itHod, depts, "IT", 1, CAT)).toBe(false);
    expect(canHodExclusivelyOwnDepartmentYear(itHod, depts, "IT", 3, CAT)).toBe(true);
  });

  it("still refuses a department outside the HOD's tree entirely", () => {
    expect(canHodExclusivelyOwnDepartmentYear(itHod, depts, "AIML", 1, CAT)).toBe(false);
    expect(canHodExclusivelyOwnDepartmentYear(aiHod, depts, "IT", 2, CAT)).toBe(false);
  });
});
