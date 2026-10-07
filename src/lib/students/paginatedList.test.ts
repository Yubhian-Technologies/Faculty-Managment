import { describe, it, expect } from "vitest";
import { fetchMatchingStudentIds, fetchStudentsPage, rollInRange } from "@/lib/students/paginatedList";
import { fakeStudentsCollection } from "@/lib/students/fakeStudentsCollection.testutil";

describe("rollInRange", () => {
  it("matches everything (even a missing roll) when no range is set", () => {
    expect(rollInRange("24PA1A1241", {})).toBe(true);
    expect(rollInRange(undefined, { rollFrom: "", rollTo: "  " })).toBe(true);
  });

  it("is inclusive at both ends and ignores case", () => {
    const range = { rollFrom: "24pa1a1241", rollTo: "24PA1A1250" };
    expect(rollInRange("24PA1A1241", range)).toBe(true);
    expect(rollInRange("24pa1a1245", range)).toBe(true);
    expect(rollInRange("24PA1A1250", range)).toBe(true);
    expect(rollInRange("24PA1A1240", range)).toBe(false);
    expect(rollInRange("24PA1A1251", range)).toBe(false);
  });

  it("swaps a range typed the wrong way round", () => {
    expect(rollInRange("24PA1A1245", { rollFrom: "24PA1A1250", rollTo: "24PA1A1241" })).toBe(true);
  });

  it("supports an open-ended range", () => {
    expect(rollInRange("243", { rollFrom: "244" })).toBe(false);
    expect(rollInRange("250", { rollFrom: "244" })).toBe(true);
    expect(rollInRange("250", { rollTo: "249" })).toBe(false);
    expect(rollInRange("245", { rollTo: "249" })).toBe(true);
  });

  it("never matches a student with no roll number once a range is active", () => {
    expect(rollInRange("", { rollFrom: "A" })).toBe(false);
    expect(rollInRange(undefined, { rollTo: "Z" })).toBe(false);
    expect(rollInRange("   ", { rollFrom: "A", rollTo: "Z" })).toBe(false);
  });
});

// A feeder department holds the shared first year for several branches at once:
// the student's own department is "Basic Science - Chemistry" and the real
// branch is recorded as their Core Department (secondaryDepartment). The Core
// Department filter narrows that roll-up to one branch.
const FEEDER = "Basic Science - Chemistry";
const roster = () => fakeStudentsCollection([
  { id: "a", data: { name: "Asha", rollNumber: "24A001", department: FEEDER, secondaryDepartment: "CSE", year: 1 } },
  { id: "b", data: { name: "Bhanu", rollNumber: "24A002", department: FEEDER, secondaryDepartment: "CSBS", year: 1 } },
  { id: "c", data: { name: "Chetan", rollNumber: "24A003", department: FEEDER, secondaryDepartment: "CSE", year: 1 } },
  // No Core Department recorded at all - must not match a narrowed filter.
  { id: "d", data: { name: "Divya", rollNumber: "24A004", department: FEEDER, year: 1 } },
  // A different department entirely.
  { id: "e", data: { name: "Eswar", rollNumber: "24A005", department: "Civil", secondaryDepartment: "CSE", year: 2 } },
]);

const query = (over: Partial<Parameters<typeof fetchStudentsPage>[1]> = {}) => ({
  page: 1, pageSize: 20, search: "", departments: [FEEDER],
  course: "", year: null, studentType: "", ...over,
});

describe("coreDepartment filter", () => {
  it("keeps only the students of the picked branch", async () => {
    const { collection } = roster();
    const { students, total } = await fetchStudentsPage(collection, query({ coreDepartment: "CSE" }));
    expect(students.map((s) => s.id)).toEqual(["a", "c"]);
    expect(total).toBe(2);
  });

  it("leaves the department's whole roll-up alone when no branch is picked", async () => {
    const { collection } = roster();
    const { students } = await fetchStudentsPage(collection, query());
    expect(students.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  // The one that would silently widen the list rather than narrow it.
  it("never matches a student with no Core Department recorded", async () => {
    const { collection } = roster();
    const { students } = await fetchStudentsPage(collection, query({ coreDepartment: "CSBS" }));
    expect(students.map((s) => s.id)).toEqual(["b"]);
  });

  it("narrows the select-all-matching ids the same way", async () => {
    const { collection } = roster();
    const ids = await fetchMatchingStudentIds(collection, {
      departments: [FEEDER], coreDepartment: "CSE", course: "", year: null,
      search: "", studentType: "",
    });
    expect(ids).toEqual(["a", "c"]);
  });

  it("combines with the other filters rather than replacing them", async () => {
    const { collection } = roster();
    const { students } = await fetchStudentsPage(collection, query({ coreDepartment: "CSE", year: 2 }));
    expect(students).toEqual([]);
  });
});

// The branch itself: it teaches years 2-4, and the 1st years it will receive
// are held by the feeder department with the branch as their Core Department.
// A department filter matches BOTH, so "All years" on the branch used to drag
// those 1st years in - the years the department is configured for are what
// "All years" has to mean here.
const BRANCH = "Artificial Intelligence and Data Science";
const branchRoster = () => fakeStudentsCollection([
  { id: "f1", data: { name: "Asha", department: FEEDER, secondaryDepartment: BRANCH, year: 1 } },
  { id: "f2", data: { name: "Bhanu", department: FEEDER, secondaryDepartment: BRANCH, year: 1 } },
  { id: "o2", data: { name: "Chetan", department: BRANCH, year: 2 } },
  { id: "o3", data: { name: "Divya", department: BRANCH, year: 3 } },
  { id: "o4", data: { name: "Eswar", department: BRANCH, year: 4 } },
]);

const branchQuery = (over: Partial<Parameters<typeof fetchStudentsPage>[1]> = {}) => ({
  page: 1, pageSize: 20, search: "", departments: [BRANCH],
  course: "", year: null, studentType: "", ...over,
});

describe("configured-years filter", () => {
  it("drops the years the department does not teach", async () => {
    const { collection } = branchRoster();
    const { students, total } = await fetchStudentsPage(collection, branchQuery({ years: [2, 3, 4] }));
    expect(students.map((s) => s.id)).toEqual(["o2", "o3", "o4"]);
    expect(total).toBe(3);
  });

  // What the Office saw before: 1st years from the feeder department under a
  // branch that only teaches 2nd-4th.
  it("returns them all when no configured years are sent", async () => {
    const { collection } = branchRoster();
    const { students } = await fetchStudentsPage(collection, branchQuery());
    expect(students.map((s) => s.id)).toEqual(["f1", "f2", "o2", "o3", "o4"]);
  });

  it("treats an empty list as no filter, never as 'match nothing'", async () => {
    const { collection } = branchRoster();
    const { students } = await fetchStudentsPage(collection, branchQuery({ years: [] }));
    expect(students).toHaveLength(5);
  });

  it("still lets a single picked year narrow further", async () => {
    const { collection } = branchRoster();
    const { students } = await fetchStudentsPage(collection, branchQuery({ years: [2, 3, 4], year: 3 }));
    expect(students.map((s) => s.id)).toEqual(["o3"]);
  });

  it("narrows the select-all-matching ids the same way", async () => {
    const { collection } = branchRoster();
    const ids = await fetchMatchingStudentIds(collection, {
      departments: [BRANCH], course: "", year: null, years: [2, 3, 4], search: "", studentType: "",
    });
    expect(ids).toEqual(["o2", "o3", "o4"]);
  });
});
