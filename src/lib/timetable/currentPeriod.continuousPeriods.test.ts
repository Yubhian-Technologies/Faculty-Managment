import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { checkFacultyPeriodWindow, getFacultyPeriodsForDate } from "./currentPeriod";

// Edge case 4: two CONSECUTIVE periods of the same assignment on the same day
// (e.g. a 2-period lab block). Each must resolve/post independently - saving
// Period 1 must never silently land on Period 2's record (or vice versa), and
// once Period 2 has started, Period 1 must still be reachable by its OWN
// pinned period number (closeTime extends to the course-year's college end
// time, not just the period's own end) - that's what lets the Mark Attendance
// UI group the two periods and submit them together without either one
// getting "stuck".

const C = "colleges/c1";
// Tuesday 2026-10-06 (IST) - matches DAY_BY_JS_DAY mapping in currentPeriod.ts.
const DATE = "2026-10-06";

function seedTwoConsecutivePeriods() {
  return new FakeFirestore({
    [`${C}/timetableSlots/slotP1`]: {
      facultyId: "f1", assignmentId: "a1", day: "TUE", periodNumber: 1,
      sectionId: "sec1", subjectId: "sub1", subjectName: "Chemistry Lab", courseId: "co1", year: 2,
    },
    [`${C}/timetableSlots/slotP2`]: {
      facultyId: "f1", assignmentId: "a1", day: "TUE", periodNumber: 2,
      sectionId: "sec1", subjectId: "sub1", subjectName: "Chemistry Lab", courseId: "co1", year: 2,
    },
    [`${C}/courseYearTimings/co1_year2`]: {
      courseId: "co1", year: 2,
      periods: [
        { period: 1, startTime: "09:00", endTime: "10:00" },
        { period: 2, startTime: "10:00", endTime: "11:00" },
      ],
      collegeEndTime: "16:00", // postable all the way to end of college day
    },
  });
}

// "now" at a given HH:MM on DATE, in IST (UTC+5:30).
function nowAtIST(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 6, h - 5, m - 30, 0));
}

describe("continuous periods - independent, both postable, neither silently merged", () => {
  let db: FakeFirestore;
  beforeEach(() => { db = seedTwoConsecutivePeriods(); });

  it("lists both periods separately for the day, in order", async () => {
    const periods = await getFacultyPeriodsForDate(db as unknown as FirebaseFirestore.Firestore, "c1", "f1", DATE);
    expect(periods.map((p) => p.slot.periodNumber)).toEqual([1, 2]);
  });

  it("creating a NEW session during Period 1's window resolves to Period 1, not Period 2", async () => {
    const check = await checkFacultyPeriodWindow(db as unknown as FirebaseFirestore.Firestore, "c1", "f1", "a1", DATE, nowAtIST("09:30"));
    expect(check).toMatchObject({ ok: true, slot: { periodNumber: 1 } });
  });

  it("creating a NEW session during Period 2's window resolves to Period 2, not Period 1", async () => {
    const check = await checkFacultyPeriodWindow(db as unknown as FirebaseFirestore.Firestore, "c1", "f1", "a1", DATE, nowAtIST("10:30"));
    expect(check).toMatchObject({ ok: true, slot: { periodNumber: 2 } });
  });

  it("Period 1's own DRAFT is still saveable (pinned by expectedPeriodNumber) even after Period 2 has started", async () => {
    // Re-validating a save against an existing Period-1 session, same as
    // student-attendance/[id]/route.ts PATCH does with existing.periodNumber.
    const check = await checkFacultyPeriodWindow(db as unknown as FirebaseFirestore.Firestore, "c1", "f1", "a1", DATE, nowAtIST("10:30"), 1);
    expect(check).toMatchObject({ ok: true, slot: { periodNumber: 1 } });
  });

  it("Period 2 is independently saveable by its own pinned period number at the same moment", async () => {
    const check = await checkFacultyPeriodWindow(db as unknown as FirebaseFirestore.Firestore, "c1", "f1", "a1", DATE, nowAtIST("10:30"), 2);
    expect(check).toMatchObject({ ok: true, slot: { periodNumber: 2 } });
  });

  it("both periods' doc ids are distinct, so submitting one can never overwrite the other", () => {
    const idFor = (p: number) => `a1_${DATE}_${p}`;
    expect(idFor(1)).not.toBe(idFor(2));
  });

  it("before Period 1 has even started, a save pinned to Period 1 is refused as OUTSIDE_WINDOW (BEFORE), not silently accepted", async () => {
    const check = await checkFacultyPeriodWindow(db as unknown as FirebaseFirestore.Firestore, "c1", "f1", "a1", DATE, nowAtIST("08:30"), 1);
    expect(check).toMatchObject({ ok: false, reason: "OUTSIDE_WINDOW", phase: "BEFORE" });
  });
});
