import { describe, expect, it } from "vitest";
import { validatePlacement } from "./draftPlacement";
import type { TimetableContext } from "@/lib/timetable/loadContext";
import type { CourseYearTiming, Section, TimetableRules } from "@/types";

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

const placementOpts = {
  facultyId: "f1",
  facultyName: "Ramesh Rao",
  subjectId: "s1",
  day: "MON",
  startPeriod: 1,
  blockSize: 1,
  ignore: new Set<string>(),
};

describe("validatePlacement - busy-period source wording", () => {
  it("allows the same period number when the faculty teaches another section (years have their own timings)", () => {
    const ctx = makeContext({ busyFaculty: new Map([["f1", new Set(["MON:1"])]]) });
    const problem = validatePlacement(ctx, { slots: [] }, placementOpts);
    expect(problem).toBeNull();
  });

  it("does not block a cell a lending department only declared busy", () => {
    const ctx = makeContext({ declaredBusyFaculty: new Map([["f1", new Set(["MON:1"])]]) });
    expect(validatePlacement(ctx, { slots: [] }, placementOpts)).toBeNull();
  });

  it("allows the placement when the faculty isn't busy at all", () => {
    const ctx = makeContext();
    expect(validatePlacement(ctx, { slots: [] }, placementOpts)).toBeNull();
  });
});
