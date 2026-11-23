import { describe, expect, it } from "vitest";
import { addDays, indexDashSessions, markFigures, rangeWindow, sectionFigures, studentFigures, type DashSession } from "./dashboard";

const s = (date: string, period: number, marks: Record<string, string | null>, subjectId = "M1"): DashSession => ({
  sectionId: "S1", date, periodNumber: period, subjectId, subjectName: subjectId, facultyName: "F",
  entries: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
});

describe("rangeWindow", () => {
  it("month, last 30 days, custom (never past today), semester", () => {
    expect(rangeWindow("month", "2026-11-23")).toEqual({ from: "2026-11-01", to: "2026-11-23" });
    expect(rangeWindow("30d", "2026-11-23")).toEqual({ from: "2026-10-25", to: "2026-11-23" });
    expect(rangeWindow("custom", "2026-11-23", { from: "2026-11-01", to: "2026-12-10" })).toEqual({ from: "2026-11-01", to: "2026-11-23" });
    expect(rangeWindow("semester", "2026-11-23")).toEqual({ from: null, to: "2026-11-23" });
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});

describe("studentFigures", () => {
  const sessions = indexDashSessions([
    s("2026-11-02", 1, { a: "PRESENT", b: "PRESENT" }),
    s("2026-11-18", 1, { a: "PRESENT", b: "ABSENT" }),
    s("2026-11-19", 1, { a: "ON_DUTY", b: "ABSENT" }),
    s("2026-11-20", 1, { a: "ABSENT", b: "ABSENT" }),
    s("2026-11-20", 2, { a: "PRESENT", b: "ABSENT" }),
    s("2026-11-21", 1, { a: "ABSENT", b: "ABSENT" }),
  ]);

  it("counts held / attended with on duty left out, and the absent streak of whole days", () => {
    const a = studentFigures(sessions, "a", "2026-11-01", "2026-11-21");
    expect([a.held, a.attended]).toEqual([5, 3]);
    expect(a.absentStreak).toBe(1);
    expect(a.absentToday).toBe(true);
    const b = studentFigures(sessions, "b", "2026-11-01", "2026-11-21");
    expect([b.held, b.attended]).toEqual([6, 1]);
    expect(b.absentStreak).toBe(4);
  });

  it("splits the last 14 days from the rest, and respects the Date of Joining", () => {
    const b = studentFigures(sessions, "b", "2026-11-01", "2026-11-21");
    expect(b.earlierPct).toBe(100);
    expect(b.recentPct).toBe(0);
    const late = studentFigures(sessions, "b", "2026-11-01", "2026-11-21", "2026-11-20");
    expect([late.held, late.attended]).toEqual([3, 0]);
  });
});

describe("markFigures / sectionFigures", () => {
  it("daily trend, weekday, subject (lowest first) and today's periods", () => {
    const m = markFigures([
      s("2026-11-20", 1, { a: "PRESENT", b: "ABSENT" }, "X"),
      s("2026-11-21", 1, { a: "PRESENT", b: "PRESENT" }, "Y"),
      s("2026-11-21", 2, { a: "ON_DUTY", b: "ABSENT" }, "Y"),
    ], "2026-11-01", "2026-11-21", "2026-11-21");
    expect(m.trend).toEqual([{ date: "2026-11-20", pct: 50 }, { date: "2026-11-21", pct: 66.7 }]);
    expect(m.weekdays.find((w) => w.day === 6)?.pct).toBe(66.7);
    expect(m.subjects.map((x) => x.id)).toEqual(["X", "Y"]);
    expect(m.periods).toEqual([{ period: 1, pct: 100, marked: 2 }, { period: 2, pct: 0, marked: 1 }]);
  });

  it("section row: range %, below 75 and the week-on-week change", () => {
    const f = (held: number, attended: number, w: [number, number], p: [number, number]) => ({
      held, attended, pct: held ? Math.round((attended / held) * 1000) / 10 : null, recentPct: null, earlierPct: null,
      week: { held: w[0], attended: w[1] }, prevWeek: { held: p[0], attended: p[1] }, absentStreak: 0, absentToday: false,
    });
    const r = sectionFigures([f(10, 9, [5, 5], [5, 4]), f(10, 6, [5, 3], [5, 3])], { held: 4, attended: 3 });
    expect(r).toEqual({ pct: 75, todayPct: 75, below: 1, change: 10 });
  });
});
