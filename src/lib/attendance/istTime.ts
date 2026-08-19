// Single source of truth for "what calendar day / wall-clock time is it" across
// the attendance subsystem. Every attendance route used to derive this from
// ambient local Date getters (getFullYear/getMonth/getDate/getHours/getDay,
// toLocaleDateString with no timeZone) - which reflects whichever machine
// happens to run the code (a Vercel function in UTC, a dev box in some other
// zone, occasionally the viewer's own browser), not the college. All colleges
// in this system are in India, so IST is fixed here rather than treated as
// ambient or per-college configurable. Every date-of-record read/write in the
// attendance module should go through this file instead of local Date getters.
const IST_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // fixed - India observes no DST

interface ISTParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: IST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function getISTParts(date: Date = new Date()): ISTParts {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24, // hour12:false reports midnight as "24"
    minute: get("minute"),
  };
}

// "YYYY-MM-DD" calendar-day key, in IST, for a given instant - the value
// every attendance doc id / date comparison should key off instead of a
// locally-computed one.
export function istDateKey(date: Date = new Date()): string {
  const { year, month, day } = getISTParts(date);
  return istDateKeyFromParts(year, month, day);
}

export function istDateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// "HH:MM" wall-clock time, in IST, for a given instant.
export function istTimeHHMM(date: Date = new Date()): string {
  const { hour, minute } = getISTParts(date);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// The UTC instant corresponding to midnight IST on the given y/m/d
// (1-indexed month) - the value to store in a Firestore `date` field so every
// reader, regardless of its own process timezone, reconstructs the same IST
// calendar day.
export function istDateFromParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

// Normalizes any instant down to midnight IST of its own IST calendar day.
export function istMidnightUTC(date: Date = new Date()): Date {
  const { year, month, day } = getISTParts(date);
  return istDateFromParts(year, month, day);
}

// 0 (Sunday) - 6 (Saturday), for the IST calendar day the instant falls on.
export function istDayOfWeek(date: Date = new Date()): number {
  const { year, month, day } = getISTParts(date);
  // A pure calendar computation (not an offset instant) - Date.UTC(y,m,d)
  // treats (y,m,d) as the day itself, so getUTCDay() reads back the correct
  // weekday for that calendar date regardless of host timezone.
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// [start, end) bounds for a single IST calendar day.
export function istDayBounds(date: Date = new Date()): { start: Date; end: Date } {
  const start = istMidnightUTC(date);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

// [monthStart, monthEnd) bounds, in IST, for a given year + 1-indexed month.
export function istMonthBounds(year: number, month: number): { monthStart: Date; monthEnd: Date } {
  const monthStart = istDateFromParts(year, month, 1);
  const monthEnd = month === 12 ? istDateFromParts(year + 1, 1, 1) : istDateFromParts(year, month + 1, 1);
  return { monthStart, monthEnd };
}

// Parses a "YYYY-MM-DD" request param (e.g. ?date=2026-08-18) as an IST
// calendar day; falls back to "today" (in IST) when absent/invalid. Mirrors
// the { start, end, docSuffix } shape every daily-roster route needs.
export function parseISTDateParam(dateParam: string | null | undefined): { start: Date; end: Date; docSuffix: string } {
  const match = dateParam?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const start = match
    ? istDateFromParts(Number(match[1]), Number(match[2]), Number(match[3]))
    : istMidnightUTC(new Date());
  const { end } = istDayBounds(start);
  return { start, end, docSuffix: istDateKey(start) };
}
