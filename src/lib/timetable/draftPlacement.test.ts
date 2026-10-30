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
    lentNotReady: new Map(),
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

describe("validatePlacement - labs sharing a period", () => {
  const lab = (id: string) => ({ id, type: "PRACTICAL" }) as unknown as import("@/types").Subject;
  const slot = (subjectId: string, facultyId: string, assignmentId: string) =>
    ({ assignmentId, facultyId, facultyName: facultyId, subjectId, subjectName: subjectId, subjectType: "PRACTICAL", day: "MON", periodNumber: 1 }) as unknown as import("@/types").DraftSlot;
  const ctx = makeContext({ subjectsById: new Map([["labA", lab("labA")], ["labB", lab("labB")], ["labC", lab("labC")]]) });
  // Lab A already has two faculty in the period.
  const draft = { slots: [slot("labA", "f1", "a1"), slot("labA", "f2", "a2")] };

  it("lets a second LAB join a lab that already has two faculty (two labs may share, however many faculty each has)", () => {
    expect(validatePlacement(ctx, draft, { ...placementOpts, subjectId: "labB", facultyId: "f3", assignmentId: "a3", allowSplit: true })).toBeNull();
  });

  it("still refuses a THIRD lab", () => {
    const two = { slots: [...draft.slots, slot("labB", "f3", "a3")] };
    expect(validatePlacement(ctx, two, { ...placementOpts, subjectId: "labC", facultyId: "f4", assignmentId: "a4", allowSplit: true })).toMatch(/already has 2 subjects/);
  });

  it("lets another faculty join a lab already in a two-lab period (co-teaching)", () => {
    const two = { slots: [...draft.slots, slot("labB", "f3", "a3")] };
    expect(validatePlacement(ctx, two, { ...placementOpts, subjectId: "labB", facultyId: "f5", assignmentId: "a5", coTeach: true })).toBeNull();
  });
});

describe("validatePlacement - flexible cells (lab batch / mid scope)", () => {
  const subj = (id: string) => ({ id, type: "THEORY" }) as unknown as import("@/types").Subject;
  const ctx = makeContext({ subjectsById: new Map([["s1", subj("s1")]]) });
  const placed = (assignmentId: string, extra: Record<string, unknown> = {}) =>
    ({ assignmentId, facultyId: assignmentId, facultyName: `Faculty ${assignmentId}`, subjectId: "s1", subjectName: "s1", subjectType: "THEORY", day: "MON", periodNumber: 1, ...extra }) as unknown as import("@/types").DraftSlot;
  const add = (draft: { slots: import("@/types").DraftSlot[] }, assignmentId: string, extra: { labBatch?: string; midScope?: number | null } = {}) =>
    validatePlacement(ctx, draft, { ...placementOpts, facultyId: assignmentId, assignmentId, coTeach: true, ...extra });

  it("lets two faculty of one subject take different mids in the same cell", () => {
    expect(add({ slots: [placed("f1", { midScope: 1 })] }, "f2", { midScope: 2 })).toBeNull();
  });

  it("refuses two faculty on the same mid and the same (whole) class", () => {
    expect(add({ slots: [placed("f1", { midScope: 1 })] }, "f2", { midScope: 1 })).toMatch(/already covers this batch for the same mid/);
  });

  it("lets two faculty split a lab by batch in the same cell, even on the same mid", () => {
    const draft = { slots: [placed("f1", { labBatch: "Batch 1", midScope: 1 })] };
    expect(add(draft, "f2", { labBatch: "Batch 2", midScope: 1 })).toBeNull();
    expect(add(draft, "f3", { labBatch: "batch 1", midScope: 1 })).toMatch(/already covers/); // same batch, any letter case
  });

  it("treats a whole-class faculty as overlapping every batch of the same mid", () => {
    expect(add({ slots: [placed("f1", { midScope: 1 })] }, "f2", { labBatch: "Batch 2", midScope: 1 })).toMatch(/already covers/);
  });

  it("leaves plain co-teaching (neither side flexible) untouched", () => {
    expect(add({ slots: [placed("f1")] }, "f2")).toBeNull();
    expect(add({ slots: [placed("f1", { labBatch: "Batch 1" })] }, "f2")).toBeNull();
  });
});

describe("validatePlacement - non-teaching subjects sharing a period", () => {
  const nonTeaching = (id: string) => ({ id, type: "NON_TEACHING" }) as unknown as import("@/types").Subject;
  const slot = (subjectId: string, facultyId: string, assignmentId: string) =>
    ({ assignmentId, facultyId, facultyName: facultyId, subjectId, subjectName: subjectId, subjectType: "NON_TEACHING", day: "MON", periodNumber: 1 }) as unknown as import("@/types").DraftSlot;
  const ctx = makeContext({ subjectsById: new Map([["counA", nonTeaching("counA")], ["skillB", nonTeaching("skillB")], ["nssC", nonTeaching("nssC")]]) });
  const draft = { slots: [slot("counA", "f1", "a1")] };

  it("lets a different non-teaching subject join one already placed (e.g. Counselling + Skill-Building)", () => {
    expect(validatePlacement(ctx, draft, { ...placementOpts, subjectId: "skillB", facultyId: "f2", assignmentId: "a2", allowSplit: true })).toBeNull();
  });

  it("has no cap once non-teaching is involved - a THIRD (and more) non-teaching subject can still join", () => {
    const two = { slots: [...draft.slots, slot("skillB", "f2", "a2")] };
    expect(validatePlacement(ctx, two, { ...placementOpts, subjectId: "nssC", facultyId: "f3", assignmentId: "a3", allowSplit: true })).toBeNull();
  });

  it("lets ANY subject join a period once a non-teaching one is already there (e.g. Counselling + a lab)", () => {
    const lab = makeContext({ subjectsById: new Map([["counA", nonTeaching("counA")], ["labX", { id: "labX", type: "PRACTICAL" } as unknown as import("@/types").Subject]]) });
    expect(validatePlacement(lab, draft, { ...placementOpts, subjectId: "labX", facultyId: "f2", assignmentId: "a2", allowSplit: true })).toBeNull();
  });

  it("lets a theory subject and a lab share a period (any types may split, capped at two)", () => {
    const theoryVsLab = makeContext({ subjectsById: new Map([
      ["theoryA", { id: "theoryA", type: "THEORY" } as unknown as import("@/types").Subject],
      ["labX", { id: "labX", type: "PRACTICAL" } as unknown as import("@/types").Subject],
    ]) });
    const theorySlot = { assignmentId: "a1", facultyId: "f1", facultyName: "f1", subjectId: "theoryA", subjectName: "theoryA", subjectType: "THEORY", day: "MON", periodNumber: 1 } as unknown as import("@/types").DraftSlot;
    expect(validatePlacement(theoryVsLab, { slots: [theorySlot] }, { ...placementOpts, subjectId: "labX", facultyId: "f2", assignmentId: "a2", allowSplit: true })).toBeNull();
  });

  it("still refuses a THIRD subject when no non-teaching subject is involved - the 2-cap stays", () => {
    const lab = (id: string) => ({ id, type: "PRACTICAL" }) as unknown as import("@/types").Subject;
    const labSlot = (subjectId: string, assignmentId: string) =>
      ({ assignmentId, facultyId: "f1", facultyName: "f1", subjectId, subjectName: subjectId, subjectType: "PRACTICAL", day: "MON", periodNumber: 1 }) as unknown as import("@/types").DraftSlot;
    const labCtx = makeContext({ subjectsById: new Map([["labA", lab("labA")], ["labB", lab("labB")], ["labC", lab("labC")]]) });
    const twoLabs = { slots: [labSlot("labA", "a1"), labSlot("labB", "a2")] };
    expect(validatePlacement(labCtx, twoLabs, { ...placementOpts, subjectId: "labC", facultyId: "f3", assignmentId: "a3", allowSplit: true })).toMatch(/already has 2 subjects/);
  });
});
