import { isOnDutyMark, type CountableSession, type IndexedSession } from "./counting";
import { countsFromJoining } from "./joiningDate";

// Date-wise register for the student attendance report: per student, per date, how many periods were held for them
// and how many they attended - the same rule as every other report (counting.ts): a session counts only when the
// student is on its own roster, from their Date of Joining; an ON_DUTY period is in neither number (counted apart).

/** A whole section's register covers at most this many days per request (one student's history is not capped). */
export const MAX_REGISTER_DAYS = 62;

export interface DayCell {
  held: number;
  present: number;
  onDuty: number;
}

export interface PeriodMark {
  date: string;
  periodNumber: number | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  /** PRESENT | ABSENT | ON_DUTY (anything else is read as absent). */
  mark: string;
}

type RegisterSession = CountableSession & { date: string; periodNumber?: number; subjectName?: string; subjectCode?: string };

/** Inclusive number of calendar days from `from` to `to` ("YYYY-MM-DD"). */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** One student's day cells, keyed by date. Days with nothing held for them are left out. */
export function buildDayRegister(sessions: IndexedSession<RegisterSession>[], studentId: string, joinedOn?: string): Record<string, DayCell> {
  const out: Record<string, DayCell> = {};
  for (const { session, marks } of sessions) {
    if (!marks.has(studentId)) continue;
    if (!countsFromJoining(session.date, joinedOn)) continue;
    const cell = out[session.date] ?? (out[session.date] = { held: 0, present: 0, onDuty: 0 });
    const mark = marks.get(studentId);
    if (isOnDutyMark(mark)) cell.onDuty += 1;
    else {
      cell.held += 1;
      if (mark === "PRESENT") cell.present += 1;
    }
  }
  return out;
}

/** Every period of one student, oldest first (date, then period number). */
export function studentPeriodMarks(sessions: IndexedSession<RegisterSession>[], studentId: string, joinedOn?: string): PeriodMark[] {
  const out: PeriodMark[] = [];
  for (const { session, marks } of sessions) {
    if (!marks.has(studentId)) continue;
    if (!countsFromJoining(session.date, joinedOn)) continue;
    const mark = marks.get(studentId);
    out.push({
      date: session.date,
      periodNumber: typeof session.periodNumber === "number" ? session.periodNumber : null,
      subjectId: session.subjectId,
      subjectName: session.subjectName ?? "",
      subjectCode: session.subjectCode ?? "",
      mark: isOnDutyMark(mark) ? "ON_DUTY" : mark === "PRESENT" ? "PRESENT" : "ABSENT",
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.periodNumber ?? 99) - (b.periodNumber ?? 99));
}

/** What a register cell prints: "" (no class), "OD" (only on duty), "A" (absent all day), else "present/held". */
export function dayCellText(c: DayCell | undefined): string {
  if (!c) return "";
  if (c.held === 0) return c.onDuty > 0 ? "OD" : "";
  if (c.present === 0) return "A";
  return `${c.present}/${c.held}`;
}

/** Totals over a student's day cells. */
export function registerTotals(days: Record<string, DayCell>): DayCell & { absentDays: number } {
  let held = 0, present = 0, onDuty = 0, absentDays = 0;
  for (const c of Object.values(days)) {
    held += c.held;
    present += c.present;
    onDuty += c.onDuty;
    if (c.held > 0 && c.present === 0) absentDays += 1;
  }
  return { held, present, onDuty, absentDays };
}
