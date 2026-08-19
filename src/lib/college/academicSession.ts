// A college's calendar academic session (e.g. "2026-27") - distinct from
// yearOrdinalLabel in academicYears.ts, which labels a course's 1st/2nd/3rd/4th
// year of study, not a calendar session. Session boundary mirrors the existing
// convention in management/indents/page.tsx (fiscal-year-style, April cutoff).

export function currentAcademicStartYear(): number {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export function academicSessionLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// A handful of sessions to choose from - two years back through one year
// ahead, newest first. Deliberately short (unlike indents' full history since
// EARLIEST_ACADEMIC_START_YEAR) - a Subject's session only ever needs to be
// "around now", never a decade of history.
export function recentAcademicSessions(): string[] {
  const current = currentAcademicStartYear();
  return [current + 1, current, current - 1, current - 2].map(academicSessionLabel);
}

// ─── Course academic-year labels ─────────────────────────────────────────────
// CourseAcademicYear.label is written long ("2025-2026") while AcademicSession
// .label is short ("2025-26"). Both name the same thing, so anything that
// defaults one from the other has to read either shape and emit the long one.

/** "2025-2026" - the shape CourseAcademicYear.label uses. */
export function academicYearLongLabel(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

/**
 * The start year out of either shape ("2025-26" or "2025-2026"), or undefined
 * when the label isn't a year range at all - a Principal is free to have typed
 * anything into the old free-text box, and such a value must not be mistaken
 * for a session.
 */
export function parseAcademicYearStart(label: string | undefined | null): number | undefined {
  const m = /^(\d{4})\s*-\s*(\d{2}|\d{4})$/.exec((label ?? "").trim());
  if (!m) return undefined;
  const start = Number(m[1]);
  return Number.isFinite(start) ? start : undefined;
}

/**
 * The college's academic year, long form. The stored current session wins when
 * one is set (a Principal whose calendar differs from the April cutoff), and
 * the clock supplies it otherwise.
 *
 * Derived rather than purely stored on purpose: there is no scheduler in this
 * app, so a stored-only value would sit on last year's label until somebody
 * noticed and edited it - which is the manual step this is meant to remove.
 */
export function resolveCurrentAcademicYear(storedCurrentLabel?: string | null): string {
  const stored = parseAcademicYearStart(storedCurrentLabel);
  return academicYearLongLabel(stored ?? currentAcademicStartYear());
}

/** Long-form sessions to choose from in Settings - newest first. */
export function recentAcademicYearOptions(): string[] {
  const current = currentAcademicStartYear();
  return [current + 1, current, current - 1, current - 2].map(academicYearLongLabel);
}
