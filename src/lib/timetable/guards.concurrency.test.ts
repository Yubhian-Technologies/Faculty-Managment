import { describe, expect, it } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { createAssignmentWithSlots, type CreateAssignmentInput } from "@/lib/teaching/createAssignment";
import { deleteAssignmentWithSlots } from "@/lib/teaching/deleteAssignment";
import { pinSlotWithChecks } from "./pinSlot";
import { publishSectionDraft } from "./publishDraft";
import { timingLookupFrom } from "./facultyOverlap";
import { makeLiveSlotPredicate } from "./liveSlots";
import { createLeaveRequestOnce, DuplicateLeaveSubmissionError } from "@/lib/leave/submissionGuard";
import type { CourseYearTiming } from "@/types";

// The same races as the per-module tests, under the WEAKEST isolation we can't
// rule out: a transaction is only protected on the documents it actually read,
// not on the range of a query (a document inserted into a query's results does
// NOT make it retry). That is exactly where a check-then-write transaction goes
// wrong, and exactly what the guard documents are for - every transaction that
// decides from a query also reads-and-rewrites one shared guard, so they queue.
//
// Each scenario first shows the unguarded version failing under this isolation
// (so the test proves it can detect the problem), then that the real code holds.

const C = "colleges/c1";
const weak = (seed: number) => new FakeFirestore({ latencyMs: 4, seed, validateQueryReads: false });

const timing = (year: number, periods: [number, string, string][]) =>
  ({
    courseId: "co1", year, collegeStartTime: "09:00", collegeEndTime: "16:00", numberOfPeriods: periods.length,
    periodDurationMinutes: 50, lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [],
    periods: periods.map(([period, startTime, endTime]) => ({ period, startTime, endTime })),
  }) as unknown as CourseYearTiming;
const Y1 = timing(1, [[1, "09:00", "09:50"], [2, "09:50", "10:40"], [3, "10:40", "11:30"]]);
const Y2 = timing(2, [[1, "09:30", "10:20"], [2, "10:20", "11:10"], [3, "11:10", "12:00"]]);
const lookup = timingLookupFrom([Y1, Y2]);

function assignmentInput(fake: FakeFirestore, over: Partial<CreateAssignmentInput> & { facultyId: string; subjectId: string }): CreateAssignmentInput {
  return {
    db: asFirestore(fake), collegeId: "c1", assignment: { sectionId: "s1", facultyId: over.facultyId, subjectId: over.subjectId },
    facultyName: "F", sectionId: "s1", sectionName: "A", subjectName: "S", courseId: "co1", year: 1, department: "CSE",
    timetableSemester: null, isPast: false, isLab: false, slots: [], currentAcademicYear: "2026-27",
    writer: "hod",
    ...over,
  };
}

describe("under query-range-blind isolation", () => {
  it("control: an UNGUARDED transaction still lets two requests both create the same single-faculty subject", async () => {
    let doubled = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const fake = weak(seed);
      const unguarded = (facultyId: string) =>
        fake.runTransaction(async (tx) => {
          const snap = await tx.get(fake.collection(`${C}/teachingAssignments`).where("sectionId", "==", "s1").where("subjectId", "==", "sub1"));
          if (snap.docs.length >= 1) return;
          tx.set(fake.collection(`${C}/teachingAssignments`).doc(), { sectionId: "s1", subjectId: "sub1", facultyId });
        });
      await Promise.all([unguarded("f1"), unguarded("f2")]);
      if (fake.list(`${C}/teachingAssignments`).length === 2) doubled++;
    }
    expect(doubled).toBeGreaterThan(0);
  });

  it("assignment creation: two faculty for one theory subject -> exactly one", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = weak(seed);
      const [a, b] = await Promise.all([
        createAssignmentWithSlots(assignmentInput(fake, { facultyId: "f1", subjectId: "sub1" })),
        createAssignmentWithSlots(assignmentInput(fake, { facultyId: "f2", subjectId: "sub1" })),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `seed ${seed}`).toHaveLength(1);
      expect(fake.list(`${C}/teachingAssignments`), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("assignment creation: three faculty for a lab -> exactly two", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = weak(seed);
      const r = await Promise.all(["f1", "f2", "f3"].map((f) => createAssignmentWithSlots(assignmentInput(fake, { facultyId: f, subjectId: "lab", isLab: true }))));
      expect(r.filter((x) => x.ok), `seed ${seed}`).toHaveLength(2);
    }
  });

  it("assignment creation: two subjects for one cell -> one wins and the loser leaves nothing", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = weak(seed);
      const slots = [{ day: "MON", periodNumber: 1 }];
      const [a, b] = await Promise.all([
        createAssignmentWithSlots(assignmentInput(fake, { facultyId: "f1", subjectId: "A", slots })),
        createAssignmentWithSlots(assignmentInput(fake, { facultyId: "f2", subjectId: "B", slots })),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `seed ${seed}`).toHaveLength(1);
      expect(fake.list(`${C}/timetableSlots`), `seed ${seed}`).toHaveLength(1);
      expect(fake.list(`${C}/teachingAssignments`), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("pinning: two pins into one cell -> one lands", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = weak(seed);
      fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "s1" });
      fake.seed(`${C}/teachingAssignments/a2`, { sectionId: "s1" });
      const base = { db: asFirestore(fake), collegeId: "c1", courseId: "co1", year: 1, sectionId: "s1", subjectName: "S", department: "CSE", day: "MON", periodNumber: 1, semester: null, currentAcademicYear: "2026-27", maxPeriodsPerFacultyPerDay: 6, isLiveSlot: makeLiveSlotPredicate(lookup, "2026-27"), writer: "h", facultyName: "F" };
      const [a, b] = await Promise.all([
        pinSlotWithChecks({ ...base, assignmentId: "a1", facultyId: "f1", subjectId: "A" }),
        pinSlotWithChecks({ ...base, assignmentId: "a2", facultyId: "f2", subjectId: "B" }),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `seed ${seed}`).toHaveLength(1);
      expect(fake.list(`${C}/timetableSlots`), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("pinning vs deleting its assignment never leaves an orphan slot", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = weak(seed);
      fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "s1", facultyId: "f1" });
      await Promise.allSettled([
        deleteAssignmentWithSlots(asFirestore(fake), "c1", "a1", "h"),
        pinSlotWithChecks({
          db: asFirestore(fake), collegeId: "c1", assignmentId: "a1", facultyId: "f1", facultyName: "F", courseId: "co1", year: 1,
          sectionId: "s1", subjectId: "A", subjectName: "S", department: "CSE", day: "MON", periodNumber: 1, semester: null,
          currentAcademicYear: "2026-27", maxPeriodsPerFacultyPerDay: 6,
          isLiveSlot: makeLiveSlotPredicate(lookup, "2026-27"), writer: "h",
        }),
      ]);
      const ids = new Set(fake.list(`${C}/teachingAssignments`).map((d) => d.id));
      for (const slot of fake.list(`${C}/timetableSlots`)) expect(ids.has(slot.assignmentId as string), `seed ${seed}`).toBe(true);
    }
  });

  it("publish: the same faculty in the same period of two sections -> exactly one section goes live", async () => {
    type DS = { assignmentId: string; facultyId: string; facultyName: string; subjectId: string; subjectName: string; subjectType: string; day: string; periodNumber: number };
    const ds = (a: string, day: string, p: number): DS => ({ assignmentId: a, facultyId: "f1", facultyName: "F1", subjectId: "s" + a, subjectName: "S", subjectType: "THEORY", day, periodNumber: p });
    for (let seed = 1; seed <= 20; seed++) {
      const fake = weak(seed);
      for (const [id, year, slot] of [["s1", 1, ds("a1", "MON", 2)], ["s2", 2, ds("a2", "MON", 2)]] as const) {
        fake.seed(`${C}/sections/${id}`, { department: "CSE", courseId: "co1", year });
        fake.seed(`${C}/teachingAssignments/${slot.assignmentId}`, { sectionId: id, facultyId: "f1" });
        fake.seed(`${C}/timetableDrafts/${id}`, { sectionId: id, courseId: "co1", year, status: "DRAFT", slots: [slot] });
      }
      const pub = (id: string, year: number) => publishSectionDraft({
        db: asFirestore(fake), collegeId: "c1", draftId: id, section: { id, department: "CSE", courseId: "co1", year },
        semester: null, currentAcademicYear: "2026-27", isLiveSlot: makeLiveSlotPredicate(lookup, "2026-27"),
        publishedByName: "h", writer: "h",
      });
      const [a, b] = await Promise.all([pub("s1", 1), pub("s2", 2)]);
      expect([a.ok, b.ok].filter(Boolean), `seed ${seed}`).toHaveLength(1);
      expect(fake.list(`${C}/timetableSlots`), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("leave submission: two at once -> one request", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = weak(seed);
      const req = { collegeId: "c1", uid: "u1", status: "PENDING_HOD" } as never;
      const results = await Promise.allSettled([
        createLeaveRequestOnce(asFirestore(fake), "c1", "u1", req),
        createLeaveRequestOnce(asFirestore(fake), "c1", "u1", req),
      ]);
      expect(fake.list(`${C}/leaveRequests`), `seed ${seed}`).toHaveLength(1);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateLeaveSubmissionError);
    }
  });
});
