import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { checkFacultyPeriodWindow } from "@/lib/timetable/currentPeriod";
import { addMinutesCapped, cleanExtraMinutes, invalidatePostingExtra } from "./attendancePosting";

const DATE = "2026-10-06"; // a Tuesday
const at = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(2026, 9, 6, h - 5, m - 30, 0)); };
const db = (extra?: number) => new FakeFirestore({
  "colleges/c1/timetableSlots/s1": { facultyId: "f1", assignmentId: "a1", day: "TUE", periodNumber: 1, sectionId: "sec1", subjectId: "sub1", subjectName: "Maths", courseId: "co1", year: 2 },
  "colleges/c1/courseYearTimings/co1_year2": { courseId: "co1", year: 2, collegeEndTime: "16:30", periods: [{ period: 1, startTime: "09:00", endTime: "10:00" }] },
  ...(extra != null ? { "colleges/c1/settings/attendancePosting": { extraMinutes: extra } } : {}),
}) as unknown as FirebaseFirestore.Firestore;

describe("extra attendance posting time after college hours", () => {
  beforeEach(() => invalidatePostingExtra());

  it("adds minutes, never past 23:59; only 0..240 whole minutes", () => {
    expect(addMinutesCapped("16:30", 30)).toBe("17:00");
    expect(addMinutesCapped("23:30", 120)).toBe("23:59");
    expect(cleanExtraMinutes(30)).toBe(30);
    expect(cleanExtraMinutes(241)).toBeNull();
    expect(cleanExtraMinutes(2.5)).toBeNull();
  });

  it("without it, posting closes at the college end time", async () => {
    expect((await checkFacultyPeriodWindow(db(), "c1", "f1", "a1", DATE, at("16:20"))).ok).toBe(true);
    expect(await checkFacultyPeriodWindow(db(), "c1", "f1", "a1", DATE, at("16:40"))).toMatchObject({ ok: false, reason: "OUTSIDE_WINDOW", endTime: "16:30" });
  });

  it("with 30 extra minutes, posting stays open until 17:00", async () => {
    expect((await checkFacultyPeriodWindow(db(30), "c1", "f1", "a1", DATE, at("16:50"))).ok).toBe(true);
    invalidatePostingExtra();
    expect(await checkFacultyPeriodWindow(db(30), "c1", "f1", "a1", DATE, at("17:05"))).toMatchObject({ ok: false, endTime: "17:00" });
  });
});
