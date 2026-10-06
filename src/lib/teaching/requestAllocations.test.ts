import { describe, expect, it } from "vitest";
import { allocationFields, facultyNamesText, requestAllocations, requestAssignmentIds } from "@/lib/teaching/requestAllocations";

const bp = { day: "MON" as const, period: 2, year: 1 };

describe("requestAllocations", () => {
  it("reads a request allocated before multi-faculty existed from its flat fields", () => {
    const a = requestAllocations({ allocatedFacultyId: "f1", allocatedFacultyName: "A", teachingAssignmentId: "t1", busyPeriods: [bp] });
    expect(a).toEqual([{ facultyId: "f1", facultyName: "A", teachingAssignmentId: "t1", busyPeriods: [bp] }]);
  });
  it("prefers the allocations list", () => {
    const list = [
      { facultyId: "f1", facultyName: "A", teachingAssignmentId: "t1", busyPeriods: [] },
      { facultyId: "f2", facultyName: "B", teachingAssignmentId: "t2", busyPeriods: [bp] },
    ];
    expect(requestAllocations({ allocations: list, allocatedFacultyId: "f1" })).toBe(list);
    expect(requestAssignmentIds({ allocations: list })).toEqual(["t1", "t2"]);
  });
  it("is empty for an unallocated request", () => {
    expect(requestAllocations({})).toEqual([]);
    expect(requestAssignmentIds({})).toEqual([]);
  });
});

describe("allocationFields", () => {
  it("mirrors the first allocation into the flat fields and fills the query helpers", () => {
    const list = [
      { facultyId: "f1", facultyName: "A", teachingAssignmentId: "t1", busyPeriods: [bp] },
      { facultyId: "f2", facultyName: "B", teachingAssignmentId: "t2", busyPeriods: [] },
    ];
    expect(allocationFields(list)).toMatchObject({
      allocatedFacultyId: "f1", allocatedFacultyName: "A", teachingAssignmentId: "t1", busyPeriods: [bp],
      allocatedFacultyIds: ["f1", "f2"], teachingAssignmentIds: ["t1", "t2"],
    });
  });
});

describe("facultyNamesText", () => {
  it("joins names naturally", () => {
    const mk = (n: string) => ({ facultyId: n, facultyName: n, teachingAssignmentId: n, busyPeriods: [] });
    expect(facultyNamesText([mk("A")])).toBe("A");
    expect(facultyNamesText([mk("A"), mk("B")])).toBe("A and B");
    expect(facultyNamesText([mk("A"), mk("B"), mk("C")])).toBe("A, B and C");
    expect(facultyNamesText([])).toBe("the allocated faculty");
  });
});
