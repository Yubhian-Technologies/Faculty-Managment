import type { PayDayBasis } from "@/types/payroll";
import { monthDays as daysOfMonth } from "./rules";

// Pay days of one person for one month - pure. Pay days = days in the month - days not employed
// (before joining / after the last working day) - loss of pay. Loss of pay comes from:
//  - leave: the leave register's own monthly LOP (over-balance days, unpaid "Other" leave, On Duty
//    never proven - lib/leave/monthlySummary.ts leaveLopDaysInMonth, so payroll and the register agree);
//  - attendance: a day marked ABSENT (1) or HALF_DAY (0.5) on a working day (not Sunday, not a holiday)
//    that no approved leave / On Duty covers. Unmarked days are never assumed absent.
// The total is rounded to the nearest half day. The College Office may override it with a reason.

export interface PayDaysInput {
  month: string;                         // YYYY-MM
  basis: PayDayBasis;
  joiningDate?: string;                  // YYYY-MM-DD
  lastWorkingDate?: string;              // YYYY-MM-DD (resigned / retired)
  leaveLop: number;
  absences: { date: string; half: boolean }[];
  coveredDates: Set<string>;             // dates inside an approved leave / On Duty
  holidayDates: Set<string>;
}

export interface PayDaysAuto {
  monthDays: number;
  notEmployedDays: number;
  leaveLop: number;
  attendanceLop: number;
  absentDates: string[];
  lop: number;
  payDays: number;
}

export const toHalf = (x: number) => Math.round(Math.round(x * 1e6) / 1e6 * 2) / 2;
const isSunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

export function monthBounds(month: string) {
  const last = daysOfMonth(month);
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, "0")}`, calendarDays: last };
}

/** Whether a person belongs in a month's run at all: joined by its last day, not gone before its first. */
export function employedInMonth(month: string, joiningDate?: string, lastWorkingDate?: string): boolean {
  const { first, last } = monthBounds(month);
  return (!joiningDate || joiningDate <= last) && (!lastWorkingDate || lastWorkingDate >= first);
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function payDaysFor(input: PayDaysInput): PayDaysAuto {
  const { first, last, calendarDays } = monthBounds(input.month);
  const monthDays = daysOfMonth(input.month, input.basis);
  const from = input.joiningDate && input.joiningDate > first ? input.joiningDate : first;
  const to = input.lastWorkingDate && input.lastWorkingDate < last ? input.lastWorkingDate : last;
  const employedCalendar = from > to ? 0 : dayDiff(from, to) + 1;
  const notEmployedDays = Math.min(monthDays, calendarDays - employedCalendar);
  const employed = monthDays - notEmployedDays;

  const absentDates: string[] = [];
  let attendanceLop = 0;
  for (const a of [...input.absences].sort((x, y) => x.date.localeCompare(y.date))) {
    if (a.date < from || a.date > to || isSunday(a.date) || input.holidayDates.has(a.date) || input.coveredDates.has(a.date)) continue;
    if (absentDates.includes(a.date)) continue;
    absentDates.push(a.date);
    attendanceLop += a.half ? 0.5 : 1;
  }
  const leaveLop = Math.max(0, input.leaveLop);
  const lop = Math.min(employed, toHalf(leaveLop + attendanceLop));
  return { monthDays, notEmployedDays, leaveLop: Math.round(leaveLop * 100) / 100, attendanceLop, absentDates, lop, payDays: employed - lop };
}
