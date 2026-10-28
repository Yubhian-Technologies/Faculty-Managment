import { describe, expect, it } from "vitest";
import { autoFill, checkSlots, cleanDays, cleanSessions, examDaysBetween, rescheduleSlots, timeLabel } from "./rules";

const S = [{ id: "S1", label: "Morning", from: "10:00", to: "11:30" }, { id: "S2", label: "Afternoon", from: "14:00", to: "15:30" }];
const subj = (n: number) => ({ subjectId: `s${n}`, subjectCode: `C${n}`, subjectName: `Subject ${n}` });

describe("mid timetable rules", () => {
  it("exam days: the Mid's dates without Sundays", () => {
    expect(examDaysBetween("2026-11-07", "2026-11-10")).toEqual(["2026-11-07", "2026-11-09", "2026-11-10"]); // 8 Nov 2026 is a Sunday
    expect(examDaysBetween("2026-11-10", "2026-11-07")).toEqual([]);
    expect(cleanDays(["2026-11-09", "2026-11-09", "bad"])).toEqual({ days: ["2026-11-09"], error: "" });
    expect(cleanDays(["2026-11-09", "2026-11-20"]).error).toBe(""); // a postponed day may fall outside the Mid's dates
    expect(cleanDays(["2026-11-09", "2027-03-01"]).error).toContain("three months");
    expect(timeLabel("14:05")).toBe("2:05 PM");
  });

  it("sessions: named, end after start, no overlap, in time order", () => {
    expect(cleanSessions([S[1], S[0]]).sessions.map((s) => s.label)).toEqual(["Morning", "Afternoon"]);
    expect(cleanSessions([{ ...S[0], to: "09:00" }]).error).toContain("end time");
    expect(cleanSessions([S[0], { ...S[1], from: "11:00" }]).error).toBe("Morning and Afternoon overlap");
    expect(cleanSessions([]).error).toBe("Add at least one session");
  });

  it("slots: branch subjects once each, a real day + session; electives share a cell under one heading", () => {
    const days = ["2026-11-09", "2026-11-10"];
    const ok = checkSlots([{ subjectId: "s1", date: "2026-11-09", sessionId: "S1" }, { subjectId: "s2", date: "2026-11-09", sessionId: "S2" }], [subj(1), subj(2)], days, S);
    expect(ok).toMatchObject({ errors: [], complete: true });
    const electives = checkSlots([{ subjectId: "s1", date: "2026-11-09", sessionId: "S1", group: " Professional  Elective-IV " }, { subjectId: "s2", date: "2026-11-09", sessionId: "S1" }], [subj(1), subj(2)], days, S);
    expect(electives.errors).toEqual([]);
    expect(electives.slots.map((x) => x.group)).toEqual(["Professional Elective-IV", "Professional Elective-IV"]);
    const partial = checkSlots([{ subjectId: "s1", date: "2026-11-09", sessionId: "S1" }, { subjectId: "s2" }], [subj(1), subj(2)], days, S);
    expect(partial).toMatchObject({ errors: [], complete: false });
    expect(checkSlots([{ subjectId: "x", date: "2026-11-09", sessionId: "S1" }], [subj(1)], days, S).errors[0]).toContain("isn't taught");
    expect(checkSlots([{ subjectId: "s1", date: "2026-11-30", sessionId: "S1" }], [subj(1)], days, S).errors[0]).toContain("exam days");
  });

  it("auto-fill: earliest free day + session in subject order, placed ones stay, leftovers reported", () => {
    const days = ["2026-11-09", "2026-11-10"];
    const one = autoFill([subj(1), subj(2), subj(3)], [], days, [S[0]]);
    expect(one.slots.map((s) => `${s.subjectId}@${s.date}`)).toEqual(["s1@2026-11-09", "s2@2026-11-10"]);
    expect(one.unplaced).toEqual(["Subject 3"]);
    const kept = autoFill([subj(1), subj(2)], [{ ...subj(2), date: "2026-11-09", sessionId: "S1" }], days, S);
    expect(kept.slots.find((s) => s.subjectId === "s1")).toMatchObject({ date: "2026-11-09", sessionId: "S2" });
  });

  it("reschedule: a day's exams move together, remember their first date, never overwrite", () => {
    const slots = [
      { ...subj(1), date: "2026-11-09", sessionId: "S1", group: "Elective" }, { ...subj(2), date: "2026-11-09", sessionId: "S1", group: "Elective" },
      { ...subj(3), date: "2026-11-10", sessionId: "S1" },
    ];
    const r = rescheduleSlots(slots, { date: "2026-11-09", sessionId: "S1" }, { date: "2026-11-16", sessionId: "S1" });
    expect(r.clash).toEqual([]);
    expect(r.moved.map((m) => [m.subjectId, m.date, m.movedFrom, m.group])).toEqual([["s1", "2026-11-16", "2026-11-09", "Elective"], ["s2", "2026-11-16", "2026-11-09", "Elective"]]);
    // moved again: still remembers the FIRST date; moved back to it: no longer "rescheduled"
    const again = rescheduleSlots(r.slots, { date: "2026-11-16", sessionId: "S1" }, { date: "2026-11-18", sessionId: "S1" });
    expect(again.moved[0].movedFrom).toBe("2026-11-09");
    const back = rescheduleSlots(again.slots, { date: "2026-11-18", sessionId: "S1" }, { date: "2026-11-09", sessionId: "S1" });
    expect(back.moved[0].movedFrom).toBeUndefined();
    expect(rescheduleSlots(slots, { date: "2026-11-09", sessionId: "S1" }, { date: "2026-11-10", sessionId: "S1" }).clash).toEqual(["Subject 3"]);
  });
});
