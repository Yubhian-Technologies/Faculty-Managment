import { calcPercent } from "./percentage";

// The ONE definition of "classes held" and "classes attended" for a student,
// shared by every student-attendance report and the student's own view. These
// used to be re-derived per route with different rules, so the same student got
// different percentages depending on which screen asked:
//   - some counted every submitted session for the subject, including a split
//     lab batch's session the student was never rostered on (silently marking
//     them absent for it);
//   - others collapsed sessions to one per subject per day, so a 3-period lab
//     block counted as a single class.
//
// The rule here: every SUBMITTED session is one period, and it counts for a
// student only if that student is on the session's own roster (`entries`) -
// which is already the right batch for a split lab, and correctly excludes
// sessions from before the student joined the section. Session ids are unique
// per (assignment, date, period), so there is nothing to dedupe.

/**
 * An ON_DUTY mark (an approved permission) counts as neither held nor attended:
 * that period is left out of the student's percentage altogether, so being away
 * on official work can't lower it - and can't inflate it either. Every place
 * that turns marks into held/attended must go through this.
 */
export const isOnDutyMark = (mark: string | null | undefined): boolean => mark === "ON_DUTY";

export interface CountableSession {
  subjectId: string;
  status?: string;
  entries: { studentId: string; status: string | null }[];
}

export interface IndexedSession<S extends CountableSession = CountableSession> {
  session: S;
  /** studentId -> mark, built once so a report over N students doesn't rescan `entries` N times. */
  marks: Map<string, string | null>;
}

export function indexSessions<S extends CountableSession>(sessions: S[]): IndexedSession<S>[] {
  return sessions.map((session) => ({
    session,
    marks: new Map(session.entries.map((e) => [e.studentId, e.status])),
  }));
}

export interface HeldAttend {
  held: number;
  attended: number;
}

/** Held/attended for one student over `sessions` (all subjects together). */
export function tallyStudent(sessions: IndexedSession[], studentId: string): HeldAttend {
  let held = 0;
  let attended = 0;
  for (const { marks } of sessions) {
    if (!marks.has(studentId)) continue;
    if (isOnDutyMark(marks.get(studentId))) continue;
    held += 1;
    if (marks.get(studentId) === "PRESENT") attended += 1;
  }
  return { held, attended };
}

/** Held/attended for one student, split by subject. */
export function tallyStudentBySubject(sessions: IndexedSession[], studentId: string): Map<string, HeldAttend> {
  const out = new Map<string, HeldAttend>();
  for (const { session, marks } of sessions) {
    if (!marks.has(studentId)) continue;
    if (isOnDutyMark(marks.get(studentId))) continue;
    const cur = out.get(session.subjectId) ?? { held: 0, attended: 0 };
    cur.held += 1;
    if (marks.get(studentId) === "PRESENT") cur.attended += 1;
    out.set(session.subjectId, cur);
  }
  return out;
}

export function withPercent(v: HeldAttend): HeldAttend & { percentage: number | null } {
  return { ...v, percentage: calcPercent(v.attended, v.held) };
}

/**
 * Days on which a student was absent for EVERY period held for them that day
 * (a day they attended even one period does not count). Powers the "absent N
 * days" list; each submitted session is one period, as everywhere above.
 */
export function countFullyAbsentDays(
  sessions: IndexedSession<CountableSession & { date: string }>[],
  studentId: string
): number {
  const byDate = new Map<string, { held: number; absent: number }>();
  for (const { session, marks } of sessions) {
    if (!marks.has(studentId)) continue;
    const day = byDate.get(session.date) ?? { held: 0, absent: 0 };
    day.held += 1;
    if (marks.get(studentId) !== "PRESENT") day.absent += 1;
    byDate.set(session.date, day);
  }
  let days = 0;
  for (const d of byDate.values()) if (d.held > 0 && d.absent === d.held) days += 1;
  return days;
}
