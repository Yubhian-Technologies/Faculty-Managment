import type { DayOfWeek } from "@/types";
import { noClassReason, type ClassDayInputs } from "@/lib/studentAttendance/classDay";
import { resolvePeriodCompletionStatus } from "@/lib/attendance/periodAttendanceStatus";
import { istDateKey } from "@/lib/attendance/istTime";
import { countsFromJoining } from "@/lib/studentAttendance/joiningDate";

// The timetable-based "classes held" denominator (audit F-25).
//
// lib/studentAttendance/counting.ts counts a period as held only when a
// SUBMITTED session exists for it, so a faculty member who never posts raises
// everyone's percentage - the missed class is invisible. This module works out
// which periods SHOULD have been held - published timetable slots, on teaching
// days, whose period has already ended - so the ones with no submitted session
// ("not posted") can be counted as held, with nobody marked present for them.
//
// It is an OPT-IN second denominator (see heldDenominator.ts); the original
// submitted-sessions-only numbers stay the default so the two can be compared
// before anything switches.
//
// Limits, deliberately stated:
//  - The timetable is read as it is NOW. A slot only counts from the day it was
//    published (its createdAt), so a new timetable never retroactively creates
//    "missed" classes for weeks before it existed; an older slot that has since
//    been replaced is simply gone, and its past periods count only if a
//    session was submitted for them (the safe direction: under- not over-count).
//  - A period is "excused" only if the caller says so (`excused`). Nothing in
//    the data model yet records a faculty leave without cover or a cancelled
//    class, so by default a not-posted period is a held-and-missed one.
//    Posting it late through the Department Office correction flow
//    (student-attendance/office-correction) turns it into a normal session.

export interface ExpectedSlot {
  assignmentId: string;
  subjectId: string;
  day: DayOfWeek;
  periodNumber: number;
  labBatch?: string | null;
  /** First IST date this slot is part of the timetable (its publish date). Absent = always. */
  activeFromISO?: string | null;
  /** Clock end of this slot's period ("HH:MM"), if its timing could be resolved. */
  endTime?: string | null;
}

export interface ExpectedPeriod {
  /** Same as the attendance session id for this period. */
  key: string;
  date: string;
  periodNumber: number;
  assignmentId: string;
  subjectId: string;
  labBatch?: string;
}

export type Calendar = Omit<ClassDayInputs, "dateISO">;

const DAY_BY_INDEX: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function eachDate(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  for (let t = Date.UTC(fy, fm - 1, fd); t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function dayNameOf(dateISO: string): DayOfWeek | null {
  const [y, m, d] = dateISO.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? null : DAY_BY_INDEX[js - 1];
}

/** Every period that should have been held in [from, to], as of `now`. */
export function listExpectedPeriods(args: {
  slots: ExpectedSlot[];
  from: string;
  to: string;
  calendar: Calendar;
  now?: Date;
}): ExpectedPeriod[] {
  const now = args.now ?? new Date();
  const today = istDateKey(now);
  const out: ExpectedPeriod[] = [];
  for (const date of eachDate(args.from, args.to)) {
    if (date > today) break;
    if (noClassReason({ dateISO: date, ...args.calendar })) continue;
    const day = dayNameOf(date);
    if (!day) continue;
    for (const slot of args.slots) {
      if (slot.day !== day) continue;
      if (slot.activeFromISO && date < slot.activeFromISO) continue;
      // Today's periods only count once they have ended - the same rule the
      // faculty "not posted" report and the cron use, so none of them disagree.
      if (date === today) {
        if (!slot.endTime) continue;
        if (resolvePeriodCompletionStatus({ dateISO: date, endTime: slot.endTime, session: null, now }) !== "NOT_MARKED") continue;
      }
      out.push({
        key: `${slot.assignmentId}_${date}_${slot.periodNumber}`,
        date,
        periodNumber: slot.periodNumber,
        assignmentId: slot.assignmentId,
        subjectId: slot.subjectId,
        ...(slot.labBatch ? { labBatch: slot.labBatch } : {}),
      });
    }
  }
  return out;
}

/** Keys of the periods that have a SUBMITTED session. A legacy session with no period number covers its assignment+date. */
export function postedKeysOf(sessions: { assignmentId: string; date: string; periodNumber?: number | null }[]): Set<string> {
  const keys = new Set<string>();
  for (const s of sessions) {
    keys.add(s.periodNumber != null ? `${s.assignmentId}_${s.date}_${s.periodNumber}` : `${s.assignmentId}_${s.date}_*`);
  }
  return keys;
}

export function notPostedOf(expected: ExpectedPeriod[], posted: ReadonlySet<string>, excused: ReadonlySet<string> = new Set()): ExpectedPeriod[] {
  return expected.filter((p) => !posted.has(p.key) && !posted.has(`${p.assignmentId}_${p.date}_*`) && !excused.has(p.key));
}

const normBatch = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export interface NotPostedIndex {
  periods: ExpectedPeriod[];
  /** Not-posted periods per subject that count against a student (a split lab only counts against its own batch). */
  forStudent(student: { labBatch?: string | null; joinedOn?: string }): Map<string, number>;
  total: number;
}

export function buildNotPostedIndex(periods: ExpectedPeriod[]): NotPostedIndex {
  const common = new Map<string, number>();
  const byBatch = new Map<string, Map<string, number>>();
  for (const p of periods) {
    if (!p.labBatch) { common.set(p.subjectId, (common.get(p.subjectId) ?? 0) + 1); continue; }
    const b = normBatch(p.labBatch);
    const m = byBatch.get(b) ?? new Map<string, number>();
    m.set(p.subjectId, (m.get(p.subjectId) ?? 0) + 1);
    byBatch.set(b, m);
  }
  return {
    periods,
    total: periods.length,
    forStudent(student) {
      // A student who joined part-way through is only owed the periods from their joining date on.
      if (student.joinedOn) {
        const own = buildNotPostedIndex(periods.filter((p) => countsFromJoining(p.date, student.joinedOn)));
        return own.forStudent({ labBatch: student.labBatch });
      }
      const out = new Map(common);
      // A student with no lab batch is excluded from every split lab period,
      // same as sectionRoster's rule for rostering one.
      const mine = byBatch.get(normBatch(student.labBatch));
      if (mine) for (const [subjectId, n] of mine) out.set(subjectId, (out.get(subjectId) ?? 0) + n);
      return out;
    },
  };
}
