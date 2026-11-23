import { isOnDutyMark } from "./counting";
import { countsFromJoining } from "./joiningDate";
import { calcPercent } from "./percentage";

// Pure figures for the Student Attendance dashboard (HOD / Principal / VP, components/attendance/
// StudentAttendanceDashboard.tsx, GET /api/college/student-attendance/dashboard). The server loads one section's
// posted sessions and roster at a time; everything that turns them into numbers lives here so it can be tested.
// Counting follows the reports: a student counts only in periods they were marked in, from their Date of Joining,
// on duty left out (neither held nor attended).

export type DashRange = "semester" | "month" | "30d" | "custom";

export interface DashSession {
  sectionId: string;
  date: string;
  periodNumber?: number;
  subjectId: string;
  subjectName?: string;
  subjectCode?: string;
  facultyName?: string;
  entries: { studentId: string; status: string | null }[];
}

export interface DashStudent {
  id: string;
  name: string;
  rollNumber: string;
  joinedOn?: string;
  mentor?: string | null;
  mobile?: string | null;
}

/** "YYYY-MM-DD" n days before / after. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The dates a range covers (semester: from its start, given per section by the caller). */
export function rangeWindow(range: DashRange, today: string, custom?: { from?: string; to?: string }): { from: string | null; to: string } {
  if (range === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (range === "30d") return { from: addDays(today, -29), to: today };
  if (range === "custom" && custom?.from && custom?.to) return { from: custom.from, to: custom.to < today ? custom.to : today };
  return { from: null, to: today };
}

interface Tally { held: number; attended: number }
const add = (t: Tally, present: boolean) => { t.held += 1; if (present) t.attended += 1; };

export interface StudentFigures {
  held: number;
  attended: number;
  pct: number | null;
  /** The last 14 days up to the range's end, and the rest of the range before them. */
  recentPct: number | null;
  earlierPct: number | null;
  /** The last 7 days and the 7 before (the section's "vs last week"). */
  week: Tally;
  prevWeek: Tally;
  /** Class days in a row, latest first, on which the student was marked and present in no period. */
  absentStreak: number;
  /** Marked today and present in no period (on duty counts as there). */
  absentToday: boolean;
}

/** A section's sessions with each one's marks keyed by student (built once per section, read once per student). */
export interface IndexedDashSession { s: DashSession; marks: Map<string, string | null> }
export function indexDashSessions(sessions: DashSession[]): IndexedDashSession[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ s, marks: new Map(s.entries.map((e) => [e.studentId, e.status])) }));
}

/**
 * One student's figures over `from`..`to` from their section's sessions (the caller passes sessions from
 * min(from, to - 13) so the two-week windows are complete). A day counts towards the absent streak only when the
 * student was marked that day; a day with any period present, or on duty, ends it.
 */
export function studentFigures(sessions: IndexedDashSession[], studentId: string, from: string, to: string, joinedOn?: string): StudentFigures {
  const all: Tally = { held: 0, attended: 0 };
  const recent: Tally = { held: 0, attended: 0 };
  const earlier: Tally = { held: 0, attended: 0 };
  const week: Tally = { held: 0, attended: 0 };
  const prevWeek: Tally = { held: 0, attended: 0 };
  const recentFrom = addDays(to, -13), weekFrom = addDays(to, -6);
  const days = new Map<string, { marked: boolean; present: boolean }>();
  for (const { s, marks } of sessions) {
    if (s.date > to || !marks.has(studentId) || !countsFromJoining(s.date, joinedOn)) continue;
    const e = { status: marks.get(studentId) ?? null };
    const day = days.get(s.date) ?? { marked: false, present: false };
    day.marked = true;
    if (e.status === "PRESENT" || isOnDutyMark(e.status)) day.present = true;
    days.set(s.date, day);
    if (isOnDutyMark(e.status)) continue;
    const present = e.status === "PRESENT";
    if (s.date >= from) {
      add(all, present);
      if (s.date >= recentFrom) add(recent, present); else add(earlier, present);
    }
    if (s.date >= weekFrom) add(week, present);
    else if (s.date >= recentFrom) add(prevWeek, present);
  }
  let absentStreak = 0;
  for (const date of [...days.keys()].sort().reverse()) {
    if (days.get(date)!.present) break;
    absentStreak += 1;
  }
  const today = days.get(to);
  return {
    held: all.held,
    attended: all.attended,
    pct: calcPercent(all.attended, all.held),
    recentPct: calcPercent(recent.attended, recent.held),
    earlierPct: calcPercent(earlier.attended, earlier.held),
    week, prevWeek,
    absentStreak,
    absentToday: !!today && today.marked && !today.present,
  };
}

const pctOf = (present: number, counted: number) => (counted ? Math.round((present / counted) * 1000) / 10 : null);

/** Mark-level figures over the range: each day, each weekday, each subject, and each period of `today`. */
export function markFigures(sessions: DashSession[], from: string, to: string, today: string) {
  const byDate = new Map<string, Tally>();
  const byWeekday = new Map<number, Tally>();
  const bySubject = new Map<string, { name: string; code: string; faculty: Set<string>; sections: Set<string>; t: Tally }>();
  const byPeriod = new Map<number, Tally>();
  for (const s of sessions) {
    if (s.date < from || s.date > to) continue;
    const d = byDate.get(s.date) ?? { held: 0, attended: 0 };
    const w = new Date(`${s.date}T00:00:00Z`).getUTCDay();
    const wd = byWeekday.get(w) ?? { held: 0, attended: 0 };
    const sub = bySubject.get(s.subjectId) ?? { name: s.subjectName ?? "", code: s.subjectCode ?? "", faculty: new Set(), sections: new Set(), t: { held: 0, attended: 0 } };
    if (s.facultyName) sub.faculty.add(s.facultyName);
    sub.sections.add(s.sectionId);
    const per = s.date === today && s.periodNumber != null ? byPeriod.get(s.periodNumber) ?? { held: 0, attended: 0 } : null;
    for (const e of s.entries) {
      if (isOnDutyMark(e.status)) continue;
      const present = e.status === "PRESENT";
      add(d, present); add(wd, present); add(sub.t, present);
      if (per) add(per, present);
    }
    byDate.set(s.date, d); byWeekday.set(w, wd); bySubject.set(s.subjectId, sub);
    if (per) byPeriod.set(s.periodNumber!, per);
  }
  return {
    trend: [...byDate.entries()].filter(([, t]) => t.held > 0).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, t]) => ({ date, pct: pctOf(t.attended, t.held)! })),
    weekdays: [1, 2, 3, 4, 5, 6].map((day) => { const t = byWeekday.get(day); return { day, pct: t ? pctOf(t.attended, t.held) : null }; }),
    subjects: [...bySubject.entries()].filter(([, v]) => v.t.held > 0)
      .map(([id, v]) => ({ id, name: v.name, code: v.code, faculty: [...v.faculty].sort(), sections: v.sections.size, pct: pctOf(v.t.attended, v.t.held)! }))
      .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name)),
    periods: [...byPeriod.entries()].sort((a, b) => a[0] - b[0]).map(([period, t]) => ({ period, pct: pctOf(t.attended, t.held), marked: t.held })),
  };
}

/** A section's row: today, the range, students below 75%, and the last 7 days against the 7 before (points). */
export function sectionFigures(students: StudentFigures[], todayCounted: { held: number; attended: number }, short = 75) {
  let held = 0, attended = 0, below = 0, wH = 0, wA = 0, pH = 0, pA = 0;
  for (const f of students) {
    held += f.held; attended += f.attended;
    if (f.pct != null && f.pct < short) below += 1;
    wH += f.week.held; wA += f.week.attended; pH += f.prevWeek.held; pA += f.prevWeek.attended;
  }
  const week = pctOf(wA, wH), prev = pctOf(pA, pH);
  return {
    pct: pctOf(attended, held),
    todayPct: pctOf(todayCounted.attended, todayCounted.held),
    below,
    change: week != null && prev != null ? Math.round((week - prev) * 10) / 10 : null,
  };
}
