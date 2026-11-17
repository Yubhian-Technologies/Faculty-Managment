import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// A leave substitute who teaches the section teaches THEIR OWN subject in the period (posted under their own
// assignment); one who doesn't teach it (another department, no subject) marks attendance only under the absent
// faculty's subject, with no Record of the Class Work needed.

vi.mock("@/lib/leave/periodCoverage", () => ({
  resolveSubstituteSlotsForDate: vi.fn(async (_db: unknown, _c: string, subId: string) =>
    subId === "fB" || subId === "fC" ? new Map([["slotA1", { originalFacultyId: "uA", originalFacultyName: "Asha" }]]) : new Map()),
}));

import { checkFacultyPeriodWindow, getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { invalidateClassAdjustmentCache } from "@/lib/classAdjustments/inForce";
import { pickOwnAssignment } from "./substituteTeaching";

const C = "colleges/c1";
const DATE = "2026-10-06"; // a Tuesday
const nowAtIST = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(2026, 9, 6, h - 5, m - 30, 0)); };

function seed() {
  return new FakeFirestore({
    [`${C}/timetableSlots/slotA1`]: { facultyId: "fA", assignmentId: "aA", day: "TUE", periodNumber: 1, sectionId: "sec1", subjectId: "subA", subjectName: "Maths", courseId: "co1", year: 2, department: "CSE" },
    [`${C}/teachingAssignments/aA`]: { facultyId: "fA", sectionId: "sec1", subjectId: "subA", subjectName: "Maths", sectionName: "A" },
    [`${C}/teachingAssignments/aB`]: { facultyId: "fB", facultyName: "Bala", sectionId: "sec1", subjectId: "subB", subjectName: "Physics", sectionName: "A", subjectType: "THEORY" },
    [`${C}/teachingAssignments/aBlab`]: { facultyId: "fB", facultyName: "Bala", sectionId: "sec1", subjectId: "subL", subjectName: "Physics Lab", sectionName: "A", subjectType: "PRACTICAL" },
    [`${C}/teachingAssignments/aC`]: { facultyId: "fC", facultyName: "Chitra", sectionId: "sec9", subjectId: "subC", subjectName: "English", sectionName: "Z" },
    [`${C}/courseYearTimings/co1_year2`]: { courseId: "co1", year: 2, collegeEndTime: "16:00", periods: [{ period: 1, startTime: "09:00", endTime: "10:00" }] },
  }) as unknown as FirebaseFirestore.Firestore;
}

describe("leave substitute: own subject or attendance only", () => {
  beforeEach(() => invalidateClassAdjustmentCache());

  it("theory before lab when the substitute teaches two subjects there", () => {
    expect(pickOwnAssignment([{ subjectName: "Physics Lab", subjectType: "PRACTICAL" }, { subjectName: "Physics", subjectType: "THEORY" }])?.subjectName).toBe("Physics");
    expect(pickOwnAssignment([])).toBeNull();
  });

  it("teaches the section -> the period is theirs under their own subject; the absent faculty's subject can't be posted", async () => {
    const db = seed();
    const periods = await getFacultyPeriodsForDate(db, "c1", "fB", DATE);
    expect(periods.map((p) => [p.slot.periodNumber, p.slot.assignmentId, p.slot.subjectName, p.attendanceOnly ?? false])).toEqual([[1, "aB", "Physics", false]]);
    expect(periods[0].adjustedFrom).toMatchObject({ adjustmentId: "LEAVE", fromFacultyName: "Asha", fromSubjectName: "Maths" });
    const ok = await checkFacultyPeriodWindow(db, "c1", "fB", "aB", DATE, nowAtIST("09:15"));
    expect(ok.ok).toBe(true);
    expect(await checkFacultyPeriodWindow(db, "c1", "fB", "aA", DATE, nowAtIST("09:15"))).toEqual({ ok: false, reason: "NOT_SCHEDULED" });
  });

  it("doesn't teach the section -> the absent faculty's period, attendance only", async () => {
    const db = seed();
    const periods = await getFacultyPeriodsForDate(db, "c1", "fC", DATE);
    expect(periods.map((p) => [p.slot.periodNumber, p.slot.assignmentId, p.slot.subjectName, p.attendanceOnly])).toEqual([[1, "aA", "Maths", true]]);
    const ok = await checkFacultyPeriodWindow(db, "c1", "fC", "aA", DATE, nowAtIST("09:15"));
    expect(ok.ok).toBe(true);
  });
});
