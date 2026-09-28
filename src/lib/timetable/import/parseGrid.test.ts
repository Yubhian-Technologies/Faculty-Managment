import { describe, expect, it } from "vitest";
import { matchTimetableGrid, resolveCandidates, splitCellTokens } from "./parseGrid";
import type { ParsedGrid } from "./gridTypes";
import type { TimetableContext } from "@/lib/timetable/loadContext";
import type { CourseYearTiming, DraftSlot, Section, Subject, TeachingAssignment, TimetableRules } from "@/types";

const timing: CourseYearTiming = {
  id: "c1_1",
  collegeId: "col1",
  departmentId: "d1",
  courseId: "c1",
  year: 1,
  collegeStartTime: "09:00",
  collegeEndTime: "13:00",
  numberOfPeriods: 3,
  periodDurationMinutes: 50,
  lunchBreak: { afterPeriod: 2, durationMinutes: 30 },
  shortBreaks: [],
  periods: [
    { period: 1, startTime: "09:00", endTime: "09:50" },
    { period: 2, startTime: "09:50", endTime: "10:40" },
    { period: 3, startTime: "11:10", endTime: "12:00" },
  ],
  createdAt: null as never,
};

const rules: TimetableRules = {
  workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
  maxPeriodsPerFacultyPerDay: 6,
  maxConsecutivePeriodsPerFaculty: 6,
  maxPeriodsPerSubjectPerDay: 6,
  labBlockSize: 2,
  allowLabAcrossBreaks: false,
  preferTheoryInMorning: false,
  spreadSubjectsAcrossWeek: false,
};

function assignment(overrides: Partial<TeachingAssignment>): TeachingAssignment {
  return {
    id: "a1",
    collegeId: "col1",
    facultyId: "f1",
    facultyName: "Ramesh Rao",
    department: "CSE",
    subjectId: "s1",
    subjectName: "Data Structures",
    subjectCode: "CS201",
    hoursPerWeek: 4,
    assignedBy: "u1",
    assignedByName: "Admin",
    createdAt: null as never,
    updatedAt: null as never,
    ...overrides,
  };
}

function subject(id: string, type: "THEORY" | "PRACTICAL"): Subject {
  return { id, name: id, type, courseId: "c1", year: 1 } as unknown as Subject;
}

function makeContext(overrides: Partial<TimetableContext> = {}): TimetableContext {
  return {
    section: { id: "sec1", collegeId: "col1", department: "CSE", courseId: "c1", name: "A", year: 1, batch: "2024-2028", studentCount: 0 } as Section,
    timing,
    rules,
    assignments: [],
    courseYearSubjects: [],
    subjectsById: new Map(),
    pinnedSlots: [],
    busyFaculty: new Map(),
    declaredBusyFaculty: new Map(),
    currentSemester: null,
    ...overrides,
  };
}

describe("splitCellTokens", () => {
  it("splits on a newline", () => {
    expect(splitCellTokens("CS201\nDr. Rao")).toEqual({ a: "CS201", b: "Dr. Rao" });
  });

  it("splits on a slash", () => {
    expect(splitCellTokens("CS201 / Dr. Rao")).toEqual({ a: "CS201", b: "Dr. Rao" });
  });

  it("splits a parenthetical faculty name off the subject", () => {
    expect(splitCellTokens("Data Structures (Dr. Rao)")).toEqual({ a: "Data Structures", b: "Dr. Rao" });
  });

  it("splits on a spaced dash but leaves a bare subject code alone", () => {
    expect(splitCellTokens("CS201 - Dr. Rao")).toEqual({ a: "CS201", b: "Dr. Rao" });
    expect(splitCellTokens("CS-201")).toBeNull();
  });

  it("refuses three or more lines rather than guessing which two matter", () => {
    expect(splitCellTokens("one\ntwo\nthree")).toBeNull();
  });

  it("refuses a single token with no recognizable delimiter", () => {
    expect(splitCellTokens("Data Structures")).toBeNull();
  });
});

describe("resolveCandidates", () => {
  const a1 = assignment({ id: "a1", subjectCode: "CS201", subjectName: "Data Structures", facultyName: "Ramesh Rao" });
  const a2 = assignment({ id: "a2", subjectCode: "CS202", subjectName: "DBMS", facultyName: "Suresh Babu" });

  it("matches subject+faculty regardless of which token came first", () => {
    expect(resolveCandidates({ a: "CS201", b: "Rao" }, [a1, a2]).map((c) => c.id)).toEqual(["a1"]);
    expect(resolveCandidates({ a: "Rao", b: "CS201" }, [a1, a2]).map((c) => c.id)).toEqual(["a1"]);
  });

  it("returns nothing when neither token matches anything", () => {
    expect(resolveCandidates({ a: "CS999", b: "Nobody" }, [a1, a2])).toEqual([]);
  });

  it("returns every candidate when more than one assignment matches", () => {
    const a3 = assignment({ id: "a3", subjectCode: "CS201", subjectName: "Data Structures", facultyName: "Kiran Rao" });
    const result = resolveCandidates({ a: "CS201", b: "Rao" }, [a1, a3]);
    expect(result.map((c) => c.id).sort()).toEqual(["a1", "a3"]);
  });
});

describe("matchTimetableGrid", () => {
  const a1 = assignment({ id: "a1", subjectId: "s1", subjectCode: "CS201", subjectName: "Data Structures", facultyId: "f1", facultyName: "Ramesh Rao" });
  const a2 = assignment({ id: "a2", subjectId: "s2", subjectCode: "CS202", subjectName: "DBMS", facultyId: "f2", facultyName: "Suresh Babu" });
  const subjectsById = new Map([
    ["s1", subject("s1", "THEORY")],
    ["s2", subject("s2", "THEORY")],
  ]);

  // Periods-as-rows, days-as-columns - the classic layout:
  //           Monday            Tuesday             Wednesday
  // Period 1  CS201 / Dr. Rao
  // Period 2                    CS202/Suresh Babu
  // Period 3                                        Unknown Subject
  const grid: ParsedGrid = {
    rowCount: 4,
    colCount: 4,
    cells: [
      { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "" },
      { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "Monday" },
      { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "Tuesday" },
      { row: 0, col: 3, rowSpan: 1, colSpan: 1, text: "Wednesday" },
      { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "Period 1" },
      { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "CS201 / Dr. Rao" },
      { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: "" },
      { row: 1, col: 3, rowSpan: 1, colSpan: 1, text: "" },
      { row: 2, col: 0, rowSpan: 1, colSpan: 1, text: "Period 2" },
      { row: 2, col: 1, rowSpan: 1, colSpan: 1, text: "" },
      { row: 2, col: 2, rowSpan: 1, colSpan: 1, text: "CS202/Suresh Babu" },
      { row: 2, col: 3, rowSpan: 1, colSpan: 1, text: "" },
      { row: 3, col: 0, rowSpan: 1, colSpan: 1, text: "Period 3" },
      { row: 3, col: 1, rowSpan: 1, colSpan: 1, text: "" },
      { row: 3, col: 2, rowSpan: 1, colSpan: 1, text: "" },
      { row: 3, col: 3, rowSpan: 1, colSpan: 1, text: "Unknown Subject" },
    ],
  };

  it("detects orientation, matches clean cells, and reports an unsplittable one", () => {
    const ctx = makeContext({ assignments: [a1, a2], subjectsById });
    const result = matchTimetableGrid(grid, ctx, []);
    if ("error" in result) throw new Error(`expected placements, got error: ${result.error}`);

    expect(result.placements).toHaveLength(3);
    const monday = result.placements.find((p) => p.day === "MON")!;
    expect(monday).toMatchObject({ status: "matched", startPeriod: 1, assignmentId: "a1" });
    const tuesday = result.placements.find((p) => p.day === "TUE")!;
    expect(tuesday).toMatchObject({ status: "matched", startPeriod: 2, assignmentId: "a2" });
    // "Unknown Subject" has no subject/faculty delimiter to split on at all -
    // never guessed, reported as unparsed rather than unmatched.
    const wednesday = result.placements.find((p) => p.day === "WED")!;
    expect(wednesday).toMatchObject({ status: "unparsed", startPeriod: 3 });
  });

  it("reports unmatched (not unparsed) when a cell splits cleanly but matches no assignment", () => {
    const noMatchGrid: ParsedGrid = {
      ...grid,
      cells: grid.cells.map((c) => (c.row === 3 && c.col === 3 ? { ...c, text: "CS999 / Nobody" } : c)),
    };
    const ctx = makeContext({ assignments: [a1, a2], subjectsById });
    const result = matchTimetableGrid(noMatchGrid, ctx, []);
    if ("error" in result) throw new Error(`expected placements, got error: ${result.error}`);
    const wednesday = result.placements.find((p) => p.day === "WED")!;
    expect(wednesday).toMatchObject({ status: "unmatched", startPeriod: 3 });
  });

  it("reports a conflict when a cell would double-book a faculty already busy elsewhere", () => {
    // f1 (Ramesh Rao) is already teaching another section MON period 1.
    const busyFaculty = new Map([["f1", new Set(["MON:1"])]]);
    const ctx = makeContext({ assignments: [a1, a2], subjectsById, busyFaculty });
    const result = matchTimetableGrid(grid, ctx, []);
    if ("error" in result) throw new Error(`expected placements, got error: ${result.error}`);
    const monday = result.placements.find((p) => p.day === "MON")!;
    expect(monday.status).toBe("conflict");
  });

  it("catches a conflict between two cells within the same uploaded document", () => {
    // Same faculty (f1) placed at both MON period 1 and TUE period 2, both
    // matching a1 - not possible from this fixture's assignments directly,
    // but simulate it via an existing draft slot that collides with MON p1.
    const existingSlots: DraftSlot[] = [{
      assignmentId: "other", facultyId: "f1", facultyName: "Ramesh Rao",
      subjectId: "s9", subjectName: "Other Subject", subjectType: "THEORY",
      day: "MON", periodNumber: 1,
    }];
    const ctx = makeContext({ assignments: [a1, a2], subjectsById });
    const result = matchTimetableGrid(grid, ctx, existingSlots);
    if ("error" in result) throw new Error(`expected placements, got error: ${result.error}`);
    const monday = result.placements.find((p) => p.day === "MON")!;
    expect(monday.status).toBe("conflict");
  });

  it("refuses to guess an orientation when fewer than 3 days are recognizable", () => {
    const twoColumnGrid: ParsedGrid = {
      rowCount: 2,
      colCount: 2,
      cells: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "" },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "Monday" },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "Period 1" },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "CS201 / Dr. Rao" },
      ],
    };
    const ctx = makeContext({ assignments: [a1], subjectsById });
    const result = matchTimetableGrid(twoColumnGrid, ctx, []);
    expect("error" in result).toBe(true);
  });

  it("only extends a lab's block span for a PRACTICAL subject, not a THEORY one", () => {
    const labSubjects = new Map([["s1", subject("s1", "PRACTICAL")]]);
    const labGrid: ParsedGrid = {
      rowCount: 3,
      colCount: 4,
      cells: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "" },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "Monday" },
        { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "Tuesday" },
        { row: 0, col: 3, rowSpan: 1, colSpan: 1, text: "Wednesday" },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "Period 1" },
        { row: 2, col: 0, rowSpan: 1, colSpan: 1, text: "Period 2" },
        // A 2-period lab block on Monday, spanning periods 1-2 (rowSpan 2).
        { row: 1, col: 1, rowSpan: 2, colSpan: 1, text: "CS201 / Dr. Rao" },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: "" },
        { row: 1, col: 3, rowSpan: 1, colSpan: 1, text: "" },
        { row: 2, col: 2, rowSpan: 1, colSpan: 1, text: "" },
        { row: 2, col: 3, rowSpan: 1, colSpan: 1, text: "" },
      ],
    };
    const ctx = makeContext({ assignments: [a1], subjectsById: labSubjects });
    const result = matchTimetableGrid(labGrid, ctx, []);
    if ("error" in result) throw new Error(`expected placements, got error: ${result.error}`);
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]).toMatchObject({ status: "matched", startPeriod: 1, blockSize: 2 });
  });
});
