import type { DayOfWeek } from "@/types";

// Query parsing shared by the "Leisure faculty" and "Teaching at this time"
// endpoints (api/college/faculty-leisure, api/college/teaching-now).

/** "HH:MM" or null. Anything else is ignored rather than guessed at. */
export function normalizeHHMM(v: string | null): string | null {
  const t = (v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null;
}

/**
 * The weekday of a "YYYY-MM-DD" date. Parsed as a plain calendar date, not an
 * instant - "2026-10-05" is that Monday whatever the server timezone is, which
 * `new Date(iso)` alone would not guarantee. Sunday is never a working day in
 * this app's DayOfWeek union, so it resolves to null.
 */
export function dayOfWeekFromISODate(iso: string): DayOfWeek | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return ([null, "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[d.getDay()] ?? null;
}
