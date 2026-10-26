import { describe, expect, it } from "vitest";
import { buildMentoringOverview, type OverviewEntry, type OverviewStudent } from "./overview";

const today = "2026-10-18";
const students: OverviewStudent[] = [
  { id: "a", department: "CSE", mentorUid: "m1", mentorName: "Dr. Rao" },
  { id: "b", department: "CSE", mentorUid: "m1", mentorName: "Dr. Rao" },
  { id: "c", department: "ECE", mentorUid: "m2", mentorName: "Ms. Devi" },
  { id: "d", department: "ECE" },
  { id: "e", department: "ECE", mentorUid: "m2", mentorName: "Ms. Devi", status: "GRADUATED" },
];
const entry = (e: Partial<OverviewEntry> & { studentId: string; section: string }): OverviewEntry => e;

describe("buildMentoringOverview", () => {
  const entries: OverviewEntry[] = [
    entry({ studentId: "a", section: "meetings", date: "2026-10-10", categories: ["ACADEMIC", "GOALS"] }),
    entry({ studentId: "a", section: "meetings", date: "2026-07-01", categories: ["ACADEMIC"] }),
    entry({ studentId: "b", section: "meetings", date: "2026-08-01", categories: ["WELLBEING"] }),
    entry({ studentId: "e", section: "meetings", date: "2026-10-10", categories: ["CAREER"] }),
    entry({ studentId: "a", section: "actionItems", status: "Open", dueDate: "2026-10-01" }),
    entry({ studentId: "a", section: "actionItems", status: "In progress", dueDate: "2026-11-01" }),
    entry({ studentId: "a", section: "actionItems", status: "Done", dueDate: "2026-09-01" }),
    entry({ studentId: "c", section: "escalations", status: "Open" }),
    entry({ studentId: "c", section: "escalations", status: "Resolved" }),
    entry({ studentId: "a", section: "weeklyAttendance", status: "Present", weekStart: "2026-10-12" }),
    entry({ studentId: "a", section: "weeklyAttendance", status: "Absent", weekStart: "2026-10-05" }),
    entry({ studentId: "a", section: "weeklyAttendance", status: "Present", weekStart: "2026-08-03" }),
  ];
  const o = buildMentoringOverview(students, entries, today);

  it("counts students and who has a mentor, leaving graduated students out", () => {
    expect(o.totals).toMatchObject({ students: 4, mentored: 3, unmentored: 1, metRecently: 1, neverMet: 1, meetings: 3 });
  });
  it("counts each ticked category once per meeting", () => {
    const by = Object.fromEntries(o.categories.map((c) => [c.value, c.meetings]));
    expect(by).toEqual({ ACADEMIC: 2, WELLBEING: 1, CAREER: 0, ENGAGEMENT: 0, CAMPUS_FAMILY: 0, GOALS: 1 });
  });
  it("counts follow-ups, overdue ones and referral status", () => {
    expect(o.actions).toEqual({ open: 1, inProgress: 1, done: 1, overdue: 1 });
    expect(o.escalations).toEqual({ open: 1, underReview: 0, resolved: 1 });
  });
  it("counts only the last four weeks of check-ins", () => {
    expect(o.weekly).toEqual({ present: 1, absent: 1, excused: 0 });
  });
  it("rolls up by department and by mentor", () => {
    expect(o.byDepartment.find((r) => r.label === "CSE")).toMatchObject({ students: 2, mentored: 2, metRecently: 1, openActions: 2 });
    expect(o.byDepartment.find((r) => r.label === "ECE")).toMatchObject({ students: 2, mentored: 1, openEscalations: 1 });
    expect(o.byMentor.map((r) => r.label)).toEqual(["Dr. Rao", "Ms. Devi"]);
  });
  it("carries no text from a note", () => {
    expect(JSON.stringify(o)).not.toMatch(/concern|outcome/i);
  });
});
