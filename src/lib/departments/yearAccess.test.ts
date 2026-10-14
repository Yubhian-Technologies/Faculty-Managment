import { describe, expect, it } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { canHodViewYear, canHodWriteRoster, canHodWriteTeaching, loadYearGate, teachingWriteRefusal, yearMaintainer } from "./yearAccess";

// VIT: CSE and IT list Years 1-4; Basic Science - Maths (a sub-department of Basic Science) maintains Year 1 of both.
const departments = [
  { id: "bs", name: "Basic Science", hasSubDepartments: true, parentRunsOwnSections: false, courseScopes: { cat1: { assignedYears: [1], secondaryDepartments: ["CSE", "IT"] } } },
  { id: "bsm", name: "Basic Science - Maths", parentDepartmentId: "bs", managedDepartments: ["CSE", "IT"] },
  { id: "cse", name: "CSE", courseScopes: { cat1: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } } },
  { id: "it", name: "IT", courseScopes: { cat1: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } } },
  { id: "ece", name: "ECE", courseScopes: { cat1: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } } },
] as never[];

const bsm = { ownDepartmentNames: ["Basic Science - Maths"], childDepartmentNames: [] as string[] };
const bsHead = { ownDepartmentNames: ["Basic Science"], childDepartmentNames: ["Basic Science - Maths"] };
const cse = { ownDepartmentNames: ["CSE"], childDepartmentNames: [] as string[] };
const ece = { ownDepartmentNames: ["ECE"], childDepartmentNames: [] as string[] };

describe("who maintains a branch's year", () => {
  it("is the manager, for the years it runs", () => {
    expect(yearMaintainer(departments, "CSE", 1, "cat1")).toBe("Basic Science - Maths");
    expect(yearMaintainer(departments, "IT", 1, "cat1")).toBe("Basic Science - Maths");
  });
  it("is nobody for the branch's other years, or a branch with no manager", () => {
    expect(yearMaintainer(departments, "CSE", 3, "cat1")).toBeNull();
    expect(yearMaintainer(departments, "ECE", 1, "cat1")).toBeNull();
  });
});

describe("teaching assignments + timetable", () => {
  it("Year 1 of CSE: the maintainer writes, the owner only views", () => {
    expect(canHodWriteTeaching(bsm, departments, "CSE", 1, "cat1")).toBe(true);
    expect(canHodWriteTeaching(bsHead, departments, "CSE", 1, "cat1")).toBe(true); // the parent HOD heads the maintainer
    expect(canHodWriteTeaching(cse, departments, "CSE", 1, "cat1")).toBe(false);
  });
  it("Years 2-4 of CSE: the owner writes, the manager has nothing (it used to be able to edit them)", () => {
    for (const y of [2, 3, 4]) {
      expect(canHodWriteTeaching(cse, departments, "CSE", y, "cat1")).toBe(true);
      expect(canHodWriteTeaching(bsm, departments, "CSE", y, "cat1")).toBe(false);
    }
  });
  it("a branch nobody maintains is written by its own HOD in every year, and by nobody else", () => {
    expect(canHodWriteTeaching(ece, departments, "ECE", 1, "cat1")).toBe(true);
    expect(canHodWriteTeaching(bsm, departments, "ECE", 1, "cat1")).toBe(false);
    expect(canHodWriteTeaching(cse, departments, "ECE", 2, "cat1")).toBe(false);
  });
});

describe("students + sections", () => {
  it("only whoever heads the branch writes them - never the maintainer", () => {
    expect(canHodWriteRoster(cse, "CSE")).toBe(true);
    expect(canHodWriteRoster(bsm, "CSE")).toBe(false);
    expect(canHodWriteRoster(bsHead, "CSE")).toBe(false);
    expect(canHodWriteRoster(ece, "CSE")).toBe(false);
  });
});

describe("viewing", () => {
  it("Year 1 of CSE is visible to both its owner and its maintainer", () => {
    expect(canHodViewYear(cse, departments, "CSE", 1, "cat1")).toBe(true);
    expect(canHodViewYear(bsm, departments, "CSE", 1, "cat1")).toBe(true);
  });
  it("the maintainer sees no other year; an unrelated HOD sees nothing", () => {
    expect(canHodViewYear(bsm, departments, "CSE", 3, "cat1")).toBe(false);
    expect(canHodViewYear(ece, departments, "CSE", 1, "cat1")).toBe(false);
  });
});

describe("refusal wording", () => {
  it("tells the owner who does Year 1", () => {
    expect(teachingWriteRefusal(cse, departments, "CSE", 1, "cat1")).toMatch(/maintained by Basic Science - Maths/);
  });
  it("is plain for a year that isn't theirs at all", () => {
    expect(teachingWriteRefusal(bsm, departments, "CSE", 3, "cat1")).toBe("Year 3 of CSE isn't in your department.");
  });
});

// The loader wires the rules to the real department and course documents (cached per college).
describe("loadYearGate on stored documents", () => {
  function seed(collegeId: string) {
    const f = new FakeFirestore();
    const C = `colleges/${collegeId}`;
    for (const d of departments as unknown as { id: string }[]) f.seed(`${C}/departments/${d.id}`, d as never);
    f.seed(`${C}/courses/c-cse`, { catalogId: "cat1", departmentId: "cse", name: "B.Tech" });
    return asFirestore(f);
  }

  it("lets BS-Maths write Year 1 teaching of CSE (by the course's catalog entry), not Year 3; CSE the reverse", async () => {
    const db = seed("gate1");
    const bsmGate = await loadYearGate(db, "gate1", bsm as never);
    expect(bsmGate.teachingWrite("CSE", 1, "c-cse")).toBe(true);
    expect(bsmGate.teachingWrite("CSE", 3, "c-cse")).toBe(false);
    expect(bsmGate.rosterWrite("CSE")).toBe(false);
    expect(bsmGate.view("CSE", 1, "c-cse")).toBe(true);
    expect(bsmGate.view("CSE", 3, "c-cse")).toBe(false);
    const cseGate = await loadYearGate(db, "gate1", cse as never);
    expect(cseGate.teachingWrite("CSE", 1, "c-cse")).toBe(false);
    expect(cseGate.teachingWrite("CSE", 3, "c-cse")).toBe(true);
    expect(cseGate.rosterWrite("CSE")).toBe(true);
    expect(cseGate.teachingRefusal("CSE", 1, "c-cse")).toMatch(/maintained by Basic Science - Maths/);
  });
});
