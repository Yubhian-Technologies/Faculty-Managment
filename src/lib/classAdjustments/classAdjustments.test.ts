import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { checkFacultyPeriodWindow, getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { invalidateClassAdjustmentCache } from "./inForce";
import { applyAdjustments, clashWith, dateProblem, overlaps, type LegInForce } from "./rules";
import type { ClassAdjustmentLeg, TimetableSlot } from "@/types";

// "Adjust / Swap a Class": the colleague teaches their OWN subject in the period handed over, so the period leaves
// the giver's day and joins the taker's under the taker's own teaching assignment (attendance recorded there).

const C = "colleges/c1";
const DATE = "2026-10-06"; // a Tuesday
const nowAtIST = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(2026, 9, 6, h - 5, m - 30, 0)); };

const leg = (over: Partial<ClassAdjustmentLeg> = {}): ClassAdjustmentLeg => ({
  slotId: "slotA1", day: "TUE", periodNumber: 1, startTime: "09:00", endTime: "10:00",
  department: "CSE", courseId: "co1", year: 2, sectionId: "sec1", sectionName: "A",
  fromFacultyId: "fA", fromFacultyName: "Asha", fromAssignmentId: "aA", fromSubjectId: "subA", fromSubjectName: "Maths",
  toFacultyId: "fB", toFacultyName: "Bala", toAssignmentId: "aB", toSubjectId: "subB", toSubjectName: "Physics",
  ...over,
});

function seed(status: "ACCEPTED" | "PENDING", legs: ClassAdjustmentLeg[] = [leg()]) {
  return new FakeFirestore({
    [`${C}/timetableSlots/slotA1`]: { facultyId: "fA", assignmentId: "aA", day: "TUE", periodNumber: 1, sectionId: "sec1", subjectId: "subA", subjectName: "Maths", courseId: "co1", year: 2, department: "CSE" },
    [`${C}/timetableSlots/slotB2`]: { facultyId: "fB", assignmentId: "aB", day: "TUE", periodNumber: 2, sectionId: "sec1", subjectId: "subB", subjectName: "Physics", courseId: "co1", year: 2, department: "CSE" },
    [`${C}/courseYearTimings/co1_year2`]: {
      courseId: "co1", year: 2, collegeEndTime: "16:00",
      periods: [{ period: 1, startTime: "09:00", endTime: "10:00" }, { period: 2, startTime: "10:00", endTime: "11:00" }],
    },
    [`${C}/classAdjustments/adj1`]: { date: DATE, status, kind: legs.length > 1 ? "SWAP" : "ADJUST", legs },
  });
}

describe("class adjustment rules", () => {
  it("overlap and clash ignore the slots being swapped", () => {
    expect(overlaps({ startTime: "09:00", endTime: "10:00" }, { startTime: "09:59", endTime: "10:30" })).toBe(true);
    expect(overlaps({ startTime: "09:00", endTime: "10:00" }, { startTime: "10:00", endTime: "11:00" })).toBe(false);
    const busy = [{ slotId: "s1", startTime: "09:00", endTime: "10:00" }];
    expect(clashWith(busy, { startTime: "09:30", endTime: "10:30" })?.slotId).toBe("s1");
    expect(clashWith(busy, { startTime: "09:30", endTime: "10:30" }, ["s1"])).toBeNull();
  });

  it("dates: today up to 14 days ahead", () => {
    expect(dateProblem("2026-10-06", "2026-10-06")).toBeNull();
    expect(dateProblem("2026-10-05", "2026-10-06")).toMatch(/today or a later date/);
    expect(dateProblem("2026-10-20", "2026-10-06")).toBeNull();
    expect(dateProblem("2026-10-21", "2026-10-06")).toMatch(/14 days/);
  });

  it("the giver loses the period (also after a republish gave the slot a new id); the taker gains it as their own subject", () => {
    const legs: LegInForce[] = [{ ...leg(), adjustmentId: "adj1" }];
    const republished = { id: "newId", facultyId: "fA", assignmentId: "aA", day: "TUE", periodNumber: 1, sectionId: "sec1", subjectId: "subA" } as TimetableSlot & { id: string };
    expect(applyAdjustments([republished], legs, "fA", "c1")).toEqual([]);
    const taken = applyAdjustments([], legs, "fB", "c1");
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ assignmentId: "aB", subjectId: "subB", subjectName: "Physics", facultyId: "fB", periodNumber: 1, sectionId: "sec1" });
    expect(applyAdjustments([], legs, "fB", "c1", { onlyAssignmentId: "other" })).toEqual([]);
  });
});

describe("class adjustments in the faculty's day and the attendance write gate", () => {
  beforeEach(() => invalidateClassAdjustmentCache());

  it("ACCEPTED: period 1 is the colleague's (their subject), not the giver's", async () => {
    const db = seed("ACCEPTED") as unknown as FirebaseFirestore.Firestore;
    const a = await getFacultyPeriodsForDate(db, "c1", "fA", DATE);
    expect(a).toEqual([]);
    const b = await getFacultyPeriodsForDate(db, "c1", "fB", DATE);
    expect(b.map((p) => [p.slot.periodNumber, p.slot.assignmentId, p.slot.subjectName, !!p.adjustedFrom])).toEqual([[1, "aB", "Physics", true], [2, "aB", "Physics", false]]);
    expect(b[0].adjustedFrom).toMatchObject({ fromFacultyName: "Asha", fromSubjectName: "Maths" });

    const okB = await checkFacultyPeriodWindow(db, "c1", "fB", "aB", DATE, nowAtIST("09:15"));
    expect(okB.ok && okB.slot.periodNumber).toBe(1);
    const noA = await checkFacultyPeriodWindow(db, "c1", "fA", "aA", DATE, nowAtIST("09:15"));
    expect(noA).toEqual({ ok: false, reason: "NOT_SCHEDULED" });
  });

  it("PENDING changes nothing", async () => {
    const db = seed("PENDING") as unknown as FirebaseFirestore.Firestore;
    expect((await getFacultyPeriodsForDate(db, "c1", "fA", DATE)).map((p) => p.slot.id)).toEqual(["slotA1"]);
    const okA = await checkFacultyPeriodWindow(db, "c1", "fA", "aA", DATE, nowAtIST("09:15"));
    expect(okA.ok).toBe(true);
  });

  it("SWAP: each takes the other's period with their own subject", async () => {
    const back = leg({
      slotId: "slotB2", periodNumber: 2, startTime: "10:00", endTime: "11:00",
      fromFacultyId: "fB", fromFacultyName: "Bala", fromAssignmentId: "aB", fromSubjectId: "subB", fromSubjectName: "Physics",
      toFacultyId: "fA", toFacultyName: "Asha", toAssignmentId: "aA", toSubjectId: "subA", toSubjectName: "Maths",
    });
    const db = seed("ACCEPTED", [leg(), back]) as unknown as FirebaseFirestore.Firestore;
    const a = await getFacultyPeriodsForDate(db, "c1", "fA", DATE);
    expect(a.map((p) => [p.slot.periodNumber, p.slot.subjectName])).toEqual([[2, "Maths"]]);
    const b = await getFacultyPeriodsForDate(db, "c1", "fB", DATE);
    expect(b.map((p) => [p.slot.periodNumber, p.slot.subjectName])).toEqual([[1, "Physics"]]);
    const okA = await checkFacultyPeriodWindow(db, "c1", "fA", "aA", DATE, nowAtIST("10:15"));
    expect(okA.ok && okA.slot.periodNumber).toBe(2);
    // Asha can't post period 1 of her own assignment any more (it was handed over).
    const noA = await checkFacultyPeriodWindow(db, "c1", "fA", "aA", DATE, nowAtIST("10:15"), 1);
    expect(noA.ok).toBe(false);
  });
});
