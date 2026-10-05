import { describe, expect, it } from "vitest";
import { loadTimetableContext, type TimetableContext } from "./loadContext";
import { validatePlacement } from "./draftPlacement";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const C = "colleges/c1";

const timing = (year: number, periods: [number, string, string][]) => ({
  courseId: "co1", year, collegeStartTime: "09:00", collegeEndTime: "16:00", numberOfPeriods: periods.length,
  periodDurationMinutes: 50, lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [],
  periods: periods.map(([period, startTime, endTime]) => ({ period, startTime, endTime })),
});
const Y1 = timing(1, [[1, "09:00", "09:50"], [2, "09:50", "10:40"], [3, "10:40", "11:30"]]);
const Y2 = timing(2, [[1, "09:30", "10:20"], [2, "10:20", "11:10"], [3, "11:10", "12:00"]]);

function seedCollege(fake: FakeFirestore, opts: { noiseSlots?: number; noiseDrafts?: number; indexed?: boolean } = {}) {
  fake.seed(`${C}/courseYearTimings/co1_year1`, Y1);
  fake.seed(`${C}/courseYearTimings/co1_year2`, Y2);
  fake.seed(`${C}/sections/s1`, { name: "A", department: "CSE", courseId: "co1", year: 1 });
  fake.seed(`${C}/sections/s2`, { name: "B", department: "CSE", courseId: "co1", year: 2 });
  fake.seed(`${C}/subjects/sub1`, { courseId: "co1", year: 1, name: "Maths", type: "THEORY" });
  fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "s1", facultyId: "f1", subjectId: "sub1", facultyName: "F One" });
  fake.seed(`${C}/teachingAssignments/a2`, { sectionId: "s1", facultyId: "f2", subjectId: "sub1", facultyName: "F Two" });

  // f1 teaches year-2 section s2 on Monday period 2 (10:20-11:10) and Tuesday period 1.
  fake.seed(`${C}/timetableSlots/x1`, { sectionId: "s2", facultyId: "f1", courseId: "co1", year: 2, day: "MON", periodNumber: 2, source: "GENERATED" });
  fake.seed(`${C}/timetableSlots/x2`, { sectionId: "s2", facultyId: "f1", courseId: "co1", year: 2, day: "TUE", periodNumber: 1, source: "GENERATED" });
  // This section's own pinned slot for f2.
  fake.seed(`${C}/timetableSlots/own`, { sectionId: "s1", facultyId: "f2", courseId: "co1", year: 1, day: "FRI", periodNumber: 1, source: "MANUAL" });
  // Someone else's draft placing f2 on Wednesday period 1.
  fake.seed(`${C}/timetableDrafts/s2`, {
    sectionId: "s2", courseId: "co1", year: 2, semester: null, status: "DRAFT",
    slots: [{ facultyId: "f2", day: "WED", periodNumber: 1, assignmentId: "x", subjectId: "y" }],
    ...(opts.indexed ? { facultyIds: ["f2"] } : {}),
  });

  // Noise: other faculty everywhere. Must not need to be read.
  for (let i = 0; i < (opts.noiseSlots ?? 0); i++) {
    fake.seed(`${C}/timetableSlots/n${i}`, { sectionId: `ns${i % 10}`, facultyId: `nf${i % 40}`, courseId: "co1", year: 2, day: "MON", periodNumber: (i % 3) + 1, source: "GENERATED" });
  }
  for (let i = 0; i < (opts.noiseDrafts ?? 0); i++) {
    fake.seed(`${C}/timetableDrafts/nd${i}`, {
      sectionId: `nd${i}`, courseId: "co1", year: 2, semester: null, status: "DRAFT",
      slots: [{ facultyId: `nf${i}`, day: "MON", periodNumber: 1 }],
      ...(opts.indexed ? { facultyIds: [`nf${i}`] } : {}),
    });
  }
  if (opts.indexed) fake.seed(`${C}/settings/timetableDraftFacultyIndex`, { ready: true });
}

const cells = (ctx: TimetableContext, f: string) => Array.from(ctx.busyFaculty.get(f) ?? []).sort();

describe("loadTimetableContext - scoped reads give the same answers", () => {
  for (const indexed of [false, true]) {
    it(`busy cells for the section's faculty are exactly what a full read would give (drafts index ${indexed ? "ready" : "not ready"})`, async () => {
      const fake = new FakeFirestore();
      seedCollege(fake, { noiseSlots: 50, noiseDrafts: 10, indexed });
      const ctx = (await loadTimetableContext(asFirestore(fake), "c1", "s1"))!;
      expect(cells(ctx, "f1")).toEqual(["MON:2", "TUE:1"]);
      // f2: someone's draft (WED:1) AND this section's own pinned slot (FRI:1) - exactly as before.
      expect(cells(ctx, "f2")).toEqual(["FRI:1", "WED:1"]);
      expect(ctx.pinnedSlots.map((s) => s.id)).toEqual(["own"]);
      expect(ctx.assignments.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
    });
  }

  it("does not carry the college's unrelated faculty (nothing in the section can be placed with them)", async () => {
    const fake = new FakeFirestore();
    seedCollege(fake, { noiseSlots: 50 });
    const ctx = (await loadTimetableContext(asFirestore(fake), "c1", "s1"))!;
    expect([...ctx.busyFaculty.keys()].sort()).toEqual(["f1", "f2"]);
  });

  it("a prior semester's slot for the same faculty is still ignored (unchanged rule)", async () => {
    const fake = new FakeFirestore();
    seedCollege(fake);
    fake.seed(`${C}/courseYearTimings/co1_year2`, {
      ...Y2, semesters: [{ semester: 1, startDate: new Date(2020, 0, 1), endDate: new Date(2020, 5, 1) }, { semester: 2, startDate: new Date(2020, 6, 1), endDate: new Date(2099, 0, 1) }],
    });
    fake.seed(`${C}/timetableSlots/old`, { sectionId: "s2", facultyId: "f1", courseId: "co1", year: 2, day: "THU", periodNumber: 3, semester: 1 });
    fake.seed(`${C}/timetableSlots/cur`, { sectionId: "s2", facultyId: "f1", courseId: "co1", year: 2, day: "THU", periodNumber: 2, semester: 2 });
    const ctx = (await loadTimetableContext(asFirestore(fake), "c1", "s1"))!;
    expect(cells(ctx, "f1")).toContain("THU:2");
    expect(cells(ctx, "f1")).not.toContain("THU:3");
  });
});

describe("loadTimetableContext - read cost no longer grows with the college", () => {
  async function readsFor(noiseSlots: number, noiseDrafts: number, indexed: boolean) {
    const fake = new FakeFirestore();
    seedCollege(fake, { noiseSlots, noiseDrafts, indexed });
    fake.readCount = 0;
    await loadTimetableContext(asFirestore(fake), "c1", "s1");
    return fake.readCount;
  }

  it("slot reads stay flat as other faculty's slots multiply", async () => {
    const small = await readsFor(20, 0, true);
    const large = await readsFor(2000, 0, true);
    expect(large).toBe(small);
  });

  it("with the draft index ready, draft reads stay flat as other sections' drafts multiply", async () => {
    const small = await readsFor(0, 5, true);
    const large = await readsFor(0, 400, true);
    expect(large).toBe(small);
  });

  it("without the index it still reads every draft (old behaviour) so nothing is missed", async () => {
    const small = await readsFor(0, 5, false);
    const large = await readsFor(0, 400, false);
    expect(large - small).toBe(395);
  });
});

describe("validatePlacement - no cross-section faculty check in the draft editor (as before)", () => {
  const place = (ctx: TimetableContext, over: Partial<Parameters<typeof validatePlacement>[2]>) =>
    validatePlacement(ctx, { slots: [] }, {
      facultyId: "f1", facultyName: "F One", subjectId: "sub1", day: "MON", startPeriod: 1, blockSize: 1, ignore: new Set<string>(), ...over,
    });

  it("allows a period whose clock time overlaps the faculty's other section (different period numbers)", async () => {
    const fake = new FakeFirestore();
    seedCollege(fake);
    const ctx = (await loadTimetableContext(asFirestore(fake), "c1", "s1"))!;
    // Y1 P3 is 10:40-11:30; f1 is in Y2 P2 (10:20-11:10) on Monday.
    expect(place(ctx, { startPeriod: 3 })).toBeNull();
  });

  it("allows the same period number as the faculty's other section", async () => {
    const fake = new FakeFirestore();
    seedCollege(fake);
    const ctx = (await loadTimetableContext(asFirestore(fake), "c1", "s1"))!;
    expect(place(ctx, { startPeriod: 2 })).toBeNull(); // f1 is in period 2 of another section on MON
  });

  it("still feeds the daily cap from other sections' placements (busyFaculty is unchanged)", async () => {
    const fake = new FakeFirestore();
    seedCollege(fake);
    const ctx = (await loadTimetableContext(asFirestore(fake), "c1", "s1"))!;
    ctx.rules = { ...ctx.rules, maxPeriodsPerFacultyPerDay: 1 };
    expect(place(ctx, { startPeriod: 1 })).toMatch(/periods\/day limit/); // already has MON:2 elsewhere
  });
});
