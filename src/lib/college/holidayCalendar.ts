import type { DayOfWeek } from "@/types";

// Pure date helpers for the holiday categories (bridge days, compensatory
// Sundays). Dates are "YYYY-MM-DD" IST calendar dates; arithmetic is done in
// UTC so the machine's own time zone can never move a date.

const DAY_BY_INDEX: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function utc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysKey(key: string, days: number): string {
  return new Date(utc(key) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Weekday of a date; null for Sunday (the timetable has no Sunday). */
export function weekdayOfKey(key: string): DayOfWeek | null {
  const js = new Date(utc(key)).getUTCDay();
  return js === 0 ? null : DAY_BY_INDEX[js - 1];
}

export function isSundayKey(key: string): boolean {
  return new Date(utc(key)).getUTCDay() === 0;
}

/** The very next Sunday strictly after `key`. */
export function nextSundayAfter(key: string): string {
  const js = new Date(utc(key)).getUTCDay();
  return addDaysKey(key, js === 0 ? 7 : 7 - js);
}

/**
 * Working days sandwiched between two declared holidays (Mon + Wed -> Tue),
 * i.e. the days worth offering as a bridge holiday. `holidayKeys` is every
 * declared holiday date.
 */
export function suggestBridgeDays(holidayKeys: string[], workingDays: DayOfWeek[]): string[] {
  const set = new Set(holidayKeys);
  const out: string[] = [];
  for (const key of set) {
    const gap = addDaysKey(key, 1);
    if (set.has(gap) || !set.has(addDaysKey(key, 2))) continue;
    const day = weekdayOfKey(gap);
    if (day && workingDays.includes(day)) out.push(gap);
  }
  return out.sort();
}
