import { describe, expect, it } from "vitest";
import { describeCounts, findEmptiedCourses, findLostYears, groupCourses, sumCounts, yearRemovalMessage, type CourseLite, type YearsDepartmentWithId } from "@/lib/departments/yearDependents";
import { courseSyncPatches } from "@/lib/college/catalogSync";

// Finding 2 (pure half): which (department, course, year) slots does an edit take away?

const BTECH = "btech";
const MTECH = "mtech";

const base = (): YearsDepartmentWithId[] => [
  // VIT shape: Basic Science (no own sections) feeds year 1 through its child to the branches.
  { id: "bs", name: "Basic Science", hasSubDepartments: true, parentRunsOwnSections: false, managedDepartments: [], courseScopes: { [BTECH]: { assignedYears: [1], secondaryDepartments: ["IT", "CSE"] } } },
  { id: "bsm", name: "Basic Science - Maths", parentDepartmentId: "bs", managedDepartments: ["IT", "CSE"] },
  { id: "it", name: "IT", courseScopes: { [BTECH]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } },
  { id: "cse", name: "CSE", courseScopes: { [BTECH]: { assignedYears: [2, 3, 4], secondaryDepartments: [] }, [MTECH]: { assignedYears: [1, 2], secondaryDepartments: [] } } },
];
const courses: CourseLite[] = [
  { id: "c-bs", departmentId: "bs", catalogId: BTECH, name: "B.Tech", durationYears: 4 },
  { id: "c-it", departmentId: "it", catalogId: BTECH, name: "B.Tech", durationYears: 4 },
  { id: "c-cse", departmentId: "cse", catalogId: BTECH, name: "B.Tech", durationYears: 4 },
  { id: "c-cse-m", departmentId: "cse", catalogId: MTECH, name: "M.Tech", durationYears: 2 },
];

const edit = (before: YearsDepartmentWithId[], id: string, fn: (d: YearsDepartmentWithId) => YearsDepartmentWithId) => before.map((d) => (d.id === id ? fn(d) : d));
const lostKeys = (before: YearsDepartmentWithId[], after: YearsDepartmentWithId[]) =>
  findLostYears(before, after, courses).map((l) => `${l.departmentName}:${l.group.name}:Y${l.year}`).sort();

describe("findLostYears", () => {
  it("an edit that changes nothing loses nothing", () => {
    const before = base();
    expect(findLostYears(before, structuredClone(before), courses)).toEqual([]);
  });

  it("adding a year loses nothing", () => {
    const before = base();
    const after = edit(before, "it", (d) => ({ ...d, courseScopes: { ...d.courseScopes, [BTECH]: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } } }));
    expect(lostKeys(before, after)).toEqual([]);
  });

  it("removing a branch's own year loses exactly that slot", () => {
    const before = base();
    const after = edit(before, "it", (d) => ({ ...d, courseScopes: { ...d.courseScopes, [BTECH]: { assignedYears: [2, 3], secondaryDepartments: [] } } }));
    expect(lostKeys(before, after)).toEqual(["IT:B.Tech:Y4"]);
  });

  it("removing the shared year from Basic Science loses it for the parent, its child (inherits) AND the branches it manages", () => {
    const before = base();
    const after = edit(before, "bs", (d) => ({ ...d, courseScopes: { [BTECH]: { assignedYears: [], secondaryDepartments: ["IT", "CSE"] } } }));
    expect(lostKeys(before, after)).toEqual([
      "Basic Science - Maths:B.Tech:Y1", "Basic Science:B.Tech:Y1", "CSE:B.Tech:Y1", "IT:B.Tech:Y1",
    ]);
  });

  it("a year that is STILL covered another way is not lost (a branch keeps Y1 while its manager still teaches it)", () => {
    const before = base();
    // IT lists year 1 itself AND is managed for it; dropping IT's own year 1 leaves the manager covering it.
    const withOwn = edit(before, "it", (d) => ({ ...d, courseScopes: { [BTECH]: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } } }));
    const after = edit(withOwn, "it", (d) => ({ ...d, courseScopes: { [BTECH]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } }));
    expect(lostKeys(withOwn, after)).toEqual([]);
  });

  it("is per course: dropping M.Tech years never touches B.Tech", () => {
    const before = base();
    const after = edit(before, "cse", (d) => ({ ...d, courseScopes: { ...d.courseScopes, [MTECH]: { assignedYears: [1], secondaryDepartments: [] } } }));
    expect(lostKeys(before, after)).toEqual(["CSE:M.Tech:Y2"]);
  });

  it("clearing a per-course scope falls back to the flat years - only what the flat list lacks is lost", () => {
    const before = edit(base(), "it", (d) => ({ ...d, assignedYears: [2, 3] }));
    const after = edit(before, "it", (d) => ({ ...d, courseScopes: {} }));
    expect(lostKeys(before, after)).toEqual(["IT:B.Tech:Y4"]);
  });
});

describe("findEmptiedCourses", () => {
  it("flags a department left with NO years for a course it offers", () => {
    const before = base();
    const after = edit(before, "it", (d) => ({ ...d, courseScopes: { [BTECH]: { assignedYears: [], secondaryDepartments: [] } } }));
    expect(findEmptiedCourses(before, after, courses)).toEqual([{ departmentName: "IT", courseName: "B.Tech" }]);
  });
  it("a department that already had none is not 'emptied' by a no-op", () => {
    const before = edit(base(), "it", (d) => ({ ...d, courseScopes: {} }));
    expect(findEmptiedCourses(before, structuredClone(before), courses)).toEqual([]);
  });
  it("keeping at least one year is fine", () => {
    const before = base();
    const after = edit(before, "it", (d) => ({ ...d, courseScopes: { [BTECH]: { assignedYears: [4], secondaryDepartments: [] } } }));
    expect(findEmptiedCourses(before, after, courses)).toEqual([]);
  });
});

describe("groupCourses", () => {
  it("one family per catalog programme across departments, with the longest duration", () => {
    const groups = groupCourses(courses);
    expect(groups.map((g) => [g.catalogId, g.courseIds.length, g.maxYear]).sort()).toEqual([[BTECH, 3, 4], [MTECH, 1, 2]]);
  });
  it("legacy courses without a catalog group by name", () => {
    const g = groupCourses([{ id: "a", departmentId: "d", name: "Old Course", durationYears: 3 }, { id: "b", departmentId: "e", name: "old course", durationYears: 3 }]);
    expect(g).toHaveLength(1);
    expect(g[0].catalogId).toBeUndefined();
  });
});

describe("messages", () => {
  const counts = { sections: 2, students: 1, teachingAssignments: 0, timetableSlots: 3, subjectInstances: 0, timings: 1, examConfigs: 0 };
  it("describeCounts lists only what exists, pluralised", () => expect(describeCounts(counts)).toBe("2 sections, 1 student, 3 timetable slots, 1 timing setup"));
  it("sumCounts", () => expect(sumCounts(counts)).toBe(7));
  it("yearRemovalMessage says what blocks it and that nothing changed", () => {
    const msg = yearRemovalMessage([{ departmentName: "IT", courseName: "B.Tech", year: 4, counts, total: 7 }]);
    expect(msg).toContain("Year 4 of B.Tech in IT: 2 sections, 1 student");
    expect(msg).toContain("nothing was changed");
  });
});

// Finding 4 (pure half): which Course docs differ from the catalog?
describe("courseSyncPatches", () => {
  const docs = [
    { id: "a", name: "B.Tech", code: "BTECH", durationYears: 4 },
    { id: "b", name: "B.Tech", code: "BTECH", durationYears: 5 }, // drifted
    { id: "c", name: "Old", code: "OLD", durationYears: 4 },
  ];
  it("patches only what differs, only the fields given", () => {
    expect(courseSyncPatches(docs, { durationYears: 5 })).toEqual([{ id: "a", patch: { durationYears: 5 } }, { id: "c", patch: { durationYears: 5 } }]);
    expect(courseSyncPatches(docs, { name: "B.Tech", code: "BTECH" })).toEqual([{ id: "c", patch: { name: "B.Tech", code: "BTECH" } }]);
  });
  it("already-in-step docs produce nothing (saving unchanged values is harmless)", () => {
    expect(courseSyncPatches([docs[0]], { name: "B.Tech", code: "BTECH", durationYears: 4 })).toEqual([]);
    expect(courseSyncPatches(docs, {})).toEqual([]);
  });
  it("coerces a stored string duration before comparing", () => {
    expect(courseSyncPatches([{ id: "x", durationYears: "4" as unknown as number }], { durationYears: 4 })).toEqual([]);
  });
});
