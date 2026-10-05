import { describe, expect, it } from "vitest";
import { pinSlotWithChecks, type PinSlotInput } from "./pinSlot";
import { timingLookupFrom } from "./facultyOverlap";
import { makeLiveSlotPredicate } from "./liveSlots";
import { deleteAssignmentWithSlots } from "@/lib/teaching/deleteAssignment";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import type { CourseYearTiming } from "@/types";

const C = "colleges/c1";
const timing = (year: number, periods: [number, string, string][]) =>
  ({
    courseId: "co1", year, collegeStartTime: "09:00", collegeEndTime: "16:00", numberOfPeriods: periods.length,
    periodDurationMinutes: 50, lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [],
    periods: periods.map(([period, startTime, endTime]) => ({ period, startTime, endTime })),
  }) as unknown as CourseYearTiming;
const Y1 = timing(1, [[1, "09:00", "09:50"], [2, "09:50", "10:40"], [3, "10:40", "11:30"]]);
const Y2 = timing(2, [[1, "09:30", "10:20"], [2, "10:20", "11:10"], [3, "11:10", "12:00"]]);
const lookup = timingLookupFrom([Y1, Y2]);

function base(fake: FakeFirestore, over: Partial<PinSlotInput> = {}): PinSlotInput {
  const assignmentId = over.assignmentId ?? "a1";
  if (!fake.docs.has(`${C}/teachingAssignments/${assignmentId}`)) {
    fake.seed(`${C}/teachingAssignments/${assignmentId}`, { sectionId: over.sectionId ?? "s1", facultyId: over.facultyId ?? "f1" });
  }
  return {
    db: asFirestore(fake), collegeId: "c1", assignmentId, facultyId: "f1", facultyName: "Dr F", courseId: "co1", year: 1,
    sectionId: "s1", subjectId: "sub1", subjectName: "Maths", department: "CSE", day: "MON", periodNumber: 1,
    semester: null, currentAcademicYear: "2026-27",
    isLiveSlot: makeLiveSlotPredicate(lookup, "2026-27"), writer: "hod1",
    ...over,
  };
}
const slots = (fake: FakeFirestore) => fake.list(`${C}/timetableSlots`);

describe("pinSlotWithChecks", () => {
  it("pins a MANUAL slot with the same fields the route always wrote", async () => {
    const fake = new FakeFirestore();
    const r = await pinSlotWithChecks(base(fake, { classroom: "R1", labBatch: "Batch 1", semester: 2 }));
    expect(r.ok).toBe(true);
    expect(slots(fake)[0]).toMatchObject({
      source: "MANUAL", isPinned: true, sectionId: "s1", facultyId: "f1", day: "MON", periodNumber: 1, classroom: "R1",
      labBatch: "Batch 1", semester: 2, academicYear: "2026-27", subjectName: "Maths", assignmentId: "a1",
    });
  });

  it("applies the optional stamp (department ids) to the document", async () => {
    const fake = new FakeFirestore();
    await pinSlotWithChecks(base(fake, { stamp: (d) => ({ ...d, departmentId: "d1" }) }));
    expect(slots(fake)[0].departmentId).toBe("d1");
  });

  it("has no per-faculty daily cap: a faculty member may take any number of periods in a day", async () => {
    const fake = new FakeFirestore();
    for (let p = 1; p <= 6; p++) {
      fake.seed(`${C}/timetableSlots/x${p}`, { facultyId: "f1", sectionId: `o${p}`, courseId: "co1", year: 1, day: "MON", periodNumber: p, academicYear: "2026-27" });
    }
    expect((await pinSlotWithChecks(base(fake, { periodNumber: 7 }))).ok).toBe(true);
  });

  it("refuses a taken cell, and allows an explicit two-lab split but not a third occupant or a theory mix", async () => {
    const fake = new FakeFirestore();
    fake.seed(`${C}/subjects/lab1`, { type: "PRACTICAL" });
    fake.seed(`${C}/subjects/lab2`, { type: "PRACTICAL" });
    fake.seed(`${C}/subjects/th1`, { type: "THEORY" });
    await pinSlotWithChecks(base(fake, { assignmentId: "a1", subjectId: "lab1", facultyId: "f1" }));
    expect(await pinSlotWithChecks(base(fake, { assignmentId: "a2", subjectId: "th1", facultyId: "f2" })))
      .toMatchObject({ ok: false, error: expect.stringMatching(/already has a subject scheduled on MON period 1/) });
    const split = await pinSlotWithChecks(base(fake, { assignmentId: "a3", subjectId: "lab2", facultyId: "f3", allowSplit: true }));
    expect(split.ok).toBe(true);
    expect(await pinSlotWithChecks(base(fake, { assignmentId: "a4", subjectId: "lab2", facultyId: "f4", allowSplit: true })))
      .toMatchObject({ ok: false, error: expect.stringMatching(/already has 2 subjects sharing it/) });

    const mixed = new FakeFirestore();
    mixed.seed(`${C}/subjects/th1`, { type: "THEORY" });
    mixed.seed(`${C}/subjects/lab1`, { type: "PRACTICAL" });
    await pinSlotWithChecks(base(mixed, { assignmentId: "a1", subjectId: "th1" }));
    expect(await pinSlotWithChecks(base(mixed, { assignmentId: "a2", subjectId: "lab1", facultyId: "f2", allowSplit: true })))
      .toMatchObject({ ok: false, error: expect.stringMatching(/theory class scheduled/) });
  });

  it("does not compare a faculty member's other sections (same period number or overlapping clock time is allowed, as before)", async () => {
    const fake = new FakeFirestore();
    // f1 is already in Y2 P2 (10:20-11:10) on MON; Y1 P3 (10:40-11:30) overlaps it on the clock.
    fake.seed(`${C}/timetableSlots/x`, { facultyId: "f1", sectionId: "s2", courseId: "co1", year: 2, day: "MON", periodNumber: 2, academicYear: "2026-27" });
    expect((await pinSlotWithChecks(base(fake, { periodNumber: 3 }))).ok).toBe(true);
    expect((await pinSlotWithChecks(base(fake, { assignmentId: "a9", sectionId: "s5", periodNumber: 2 }))).ok).toBe(true);
  });

  it("refuses when the assignment was deleted after the caller looked it up", async () => {
    const fake = new FakeFirestore();
    const input = base(fake);
    await fake.doc(`${C}/teachingAssignments/a1`).delete();
    expect(await pinSlotWithChecks(input)).toMatchObject({ ok: false, error: "Teaching assignment not found" });
    expect(slots(fake)).toHaveLength(0);
  });
});

describe("pinSlotWithChecks - concurrency", () => {
  it("two pins into the same section cell: exactly one lands", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const [a, b] = await Promise.all([
        pinSlotWithChecks(base(fake, { assignmentId: "a1", subjectId: "s1", facultyId: "f1" })),
        pinSlotWithChecks(base(fake, { assignmentId: "a2", subjectId: "s2", facultyId: "f2" })),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `seed ${seed}`).toHaveLength(1);
      expect(slots(fake), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("the same faculty pinned into two sections at the same period number: both land", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const [a, b] = await Promise.all([
        pinSlotWithChecks(base(fake, { assignmentId: "a1", sectionId: "s1", year: 1, periodNumber: 2 })),
        pinSlotWithChecks(base(fake, { assignmentId: "a2", sectionId: "s2", year: 2, periodNumber: 2 })),
      ]);
      expect([a.ok, b.ok], `seed ${seed}`).toEqual([true, true]);
    }
  });

  it("pinning a slot while its assignment is being deleted never leaves an orphan slot", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const input = base(fake);
      await Promise.allSettled([
        deleteAssignmentWithSlots(asFirestore(fake), "c1", "a1", "hod1"),
        pinSlotWithChecks(input),
      ]);
      const assignmentIds = new Set(fake.list(`${C}/teachingAssignments`).map((d) => d.id));
      for (const slot of slots(fake)) {
        expect(assignmentIds.has(slot.assignmentId as string), `seed ${seed}: orphan slot ${slot.id}`).toBe(true);
      }
    }
  });
});
