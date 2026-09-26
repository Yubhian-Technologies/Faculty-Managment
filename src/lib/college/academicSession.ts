// A college's calendar academic session (e.g. "2026-27") - distinct from
// yearOrdinalLabel in academicYears.ts, which labels a course's 1st/2nd/3rd/4th
// year of study, not a calendar session. Session boundary mirrors the existing
// convention in management/indents/page.tsx (fiscal-year-style, April cutoff).

/** The day a college's academic year begins. Month is 1-12, NOT a JS month index. */
export interface AcademicYearStart {
  month: number;
  day: number;
}

/** April 1 - what every college was assumed to run on before this was configurable. */
export const DEFAULT_ACADEMIC_YEAR_START: AcademicYearStart = { month: 4, day: 1 };

/** March 31 - the day before an April 1 start comes round again. */
export const DEFAULT_ACADEMIC_YEAR_END: AcademicYearStart = { month: 3, day: 31 };

const isMonthDay = (m: unknown, d: unknown) => {
  const ok = (n: unknown, max: number) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max;
  return ok(m, 12) && ok(d, 31);
};

/** A stored start day, or April 1 when it is absent or nonsense. */
export function resolveAcademicYearStart(
  start?: { academicYearStartMonth?: number; academicYearStartDay?: number } | null
): AcademicYearStart {
  const month = start?.academicYearStartMonth;
  const day = start?.academicYearStartDay;
  return isMonthDay(month, day)
    ? { month: month as number, day: day as number }
    : DEFAULT_ACADEMIC_YEAR_START;
}

/** A stored end day, or March 31 when it is absent or nonsense. */
export function resolveAcademicYearEnd(
  end?: { academicYearEndMonth?: number; academicYearEndDay?: number } | null
): AcademicYearStart {
  const month = end?.academicYearEndMonth;
  const day = end?.academicYearEndDay;
  return isMonthDay(month, day)
    ? { month: month as number, day: day as number }
    : DEFAULT_ACADEMIC_YEAR_END;
}

/**
 * The year the CURRENT academic session started, worked out from today against
 * the college's own start day. Nothing is stored and nothing has to be
 * advanced by hand - on 31 May 2027 a June-1 college is still in 2026-27, and
 * the next day it is in 2027-28.
 *
 * Defaults to April 1, so every existing caller that passes nothing keeps the
 * exact behaviour it had when the cutoff was hardcoded.
 */
export function currentAcademicStartYear(
  now: Date = new Date(),
  start: AcademicYearStart = DEFAULT_ACADEMIC_YEAR_START
): number {
  const month = now.getMonth() + 1; // getMonth() is 0-based; `start.month` is not
  const started = month > start.month || (month === start.month && now.getDate() >= start.day);
  return started ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * The dates a session actually spans, given the start day: from the cutoff in
 * `startYear` to the day before the cutoff a year later. Returned as ISO
 * "YYYY-MM-DD" for display; nothing compares on these.
 */
export function academicYearRange(
  startYear: number,
  start: AcademicYearStart = DEFAULT_ACADEMIC_YEAR_START,
  end: AcademicYearStart = DEFAULT_ACADEMIC_YEAR_END
): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  // An end BEFORE the start in the calendar belongs to the next year (June 1
  // -> May 31); one after it stays inside the same one (Jan 1 -> Dec 31).
  const endsLater = end.month > start.month || (end.month === start.month && end.day > start.day);
  const endYear = endsLater ? startYear : startYear + 1;
  return {
    from: `${startYear}-${pad(start.month)}-${pad(start.day)}`,
    to: `${endYear}-${pad(end.month)}-${pad(end.day)}`,
  };
}

export function academicSessionLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** "2024-2028" -> 2024 (the intake/start year). Null if the label doesn't start with a 4-digit year. */
export function parseBatchStartYear(batch: string): number | null {
  const m = batch.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** "2024-2028" -> 2028 (the graduation year). Null if the label doesn't end with a 4-digit year. */
export function parseBatchEndYear(batch: string): number | null {
  const m = batch.match(/(\d{4})$/);
  return m ? Number(m[1]) : null;
}

/**
 * A Lateral-entry student's OWN batch - distinct from the Regular batch
 * physically occupying the same Section slot they're joining. They enter
 * directly at Year 2, one calendar year later than that Regular batch, and
 * spend one fewer year at the college, so their batch starts a year later
 * but ends the SAME year (they graduate together): joining a Section.batch
 * "2024-2028" slot in session 2025 gives "2025-2028". Null if `sectionBatch`
 * isn't a recognizable batch label.
 */
export function lateralEntryBatch(sectionBatch: string, asOfStartYear: number = currentAcademicStartYear()): string | null {
  const endYear = parseBatchEndYear(sectionBatch);
  return endYear != null ? `${asOfStartYear}-${endYear}` : null;
}

// The intake year a course-year sits in AS OF a given session - e.g. a 2nd
// Year course-year in session-start 2026 was admitted in 2025. Feeds
// deriveBatch below for Section.batch derivation.
export function admissionStartYearForCourseYear(asOfStartYear: number, courseYear: number): number {
  return asOfStartYear - courseYear + 1;
}

/** "2026-2030" - a course's own intake batch, from admission year + how many years it runs. */
export function deriveBatch(admissionStartYear: number, durationYears: number): string {
  return `${admissionStartYear}-${admissionStartYear + durationYears}`;
}

/**
 * Candidate intake years for the Section Batch picker, given the intake year the
 * picked course-year sits in for the current session: one intake ahead ("next
 * year"), that year ("this year"), then the last 4. Newest first. Callers map
 * each through deriveBatch() with the course's own durationYears.
 *
 * "This year" is only correct if callers anchor `centerIntakeYear` on the real
 * current academic year (currentAcademicStartYear), not on a stored session
 * pin that may be stale.
 */
export function sectionBatchIntakeYears(centerIntakeYear: number): number[] {
  return [centerIntakeYear + 1, centerIntakeYear, centerIntakeYear - 1,
          centerIntakeYear - 2, centerIntakeYear - 3, centerIntakeYear - 4];
}

/**
 * Every intake year a regulation's batch field covers. One regulation commonly
 * runs for several consecutive intakes ("2024-2028,2025-2029" - R23 governing
 * both the 2024 and 2025 admissions), so the field is a comma-separated list
 * and each entry contributes its own start year.
 */
export function parseBatchStartYears(batch: string): number[] {
  return batch
    .split(",")
    .map((part) => parseBatchStartYear(part.trim()))
    .filter((y): y is number => y != null);
}

// Which regulation code(s) cover a SPECIFIC intake batch (by its start year) -
// the direct, ground-truth resolution: a batch's own admission year is fixed
// forever once picked, so the regulation governing it never depends on "what
// session is it now" at all. Every Section-facing consumer that already has
// an actual batch in hand (picked, saved, or just normalized) should resolve
// through here, not through the year+session indirection below - otherwise
// changing the Batch field (e.g. an HOD deliberately picking an off-cycle
// admission year) silently leaves the Regulation options showing whatever the
// PREVIOUS batch resolved to, since nothing recomputes them.
//
// `fallbackRegulations` is the same backward-compatibility escape hatch as
// regulationsForCourseYearByBatch below - see its own doc-comment.
export function regulationsForBatchStartYear(
  regulationBatches: Record<string, string>,
  batchStartYear: number,
  fallbackRegulations?: string[],
): string[] {
  const entries = Object.entries(regulationBatches ?? {});
  if (entries.length === 0) {
    return Array.from(new Set((fallbackRegulations ?? []).map((r) => r.trim()).filter(Boolean)));
  }
  const matches: string[] = [];
  for (const [code, batch] of entries) {
    if (parseBatchStartYears(batch).includes(batchStartYear)) matches.push(code);
  }
  return matches;
}

// Which regulation code(s) govern ordinal course-year `courseYear` (1-based -
// 1st Year, 2nd Year, ...) AS OF a given session, derived purely from each
// regulation's own batch coverage (CourseCatalogItem.regulationBatches)
// versus that session - a batch starting in year Y sits in ordinal year
// `asOfStartYear - Y + 1` for the session starting `asOfStartYear`; this
// returns every regulation whose batch computes to exactly `courseYear` for
// that session - normally exactly one, since each admission year has its own
// regulation, but callers should treat more than one as "ambiguous, ask the
// Academics to fix the batches" rather than silently picking the first.
// `asOfStartYear` defaults to the real current session.
//
// Only for a consumer that has no actual batch to resolve against yet (e.g.
// Subjects, which are scoped by course+year with no batch of their own) -
// anything with a real Section.batch in hand should call
// regulationsForBatchStartYear directly instead (see its own doc-comment).
//
// `fallbackRegulations` is a backward-compatibility escape hatch: a catalog
// entry created under the earlier Principal-owned model stored only
// `regulations` (plus an optional `regulationYears` narrowing that no longer
// exists) and has NO `regulationBatches` at all. The pre-migration default
// was "a regulation with no year restriction is offered for every year", so
// when `regulationBatches` is empty we return the passed-in regulation list
// unchanged rather than resolving to nothing - otherwise every downstream
// picker silently shows "None assigned" for a course whose Academics has clearly
// assigned R23. Once that course is re-saved from the Course Catalog card
// (or scripts/backfill-regulation-batches.mjs runs), real batch coverage
// exists and takes over.
export function regulationsForCourseYearByBatch(
  regulationBatches: Record<string, string>,
  courseYear: number,
  asOfStartYear: number = currentAcademicStartYear(),
  fallbackRegulations?: string[],
): string[] {
  return regulationsForBatchStartYear(regulationBatches, admissionStartYearForCourseYear(asOfStartYear, courseYear), fallbackRegulations);
}

// A handful of sessions to choose from - two years back through one year
// ahead, newest first. Deliberately short (unlike indents' full history since
// EARLIEST_ACADEMIC_START_YEAR) - a Subject's session only ever needs to be
// "around now", never a decade of history.
export function recentAcademicSessions(): string[] {
  const current = currentAcademicStartYear();
  return [current + 1, current, current - 1, current - 2].map(academicSessionLabel);
}

// This calendar academic session (e.g. "2026-27") - the year-over-year
// counterpart to lib/college/semester.ts's WITHIN-a-session semester concept.
// A Section is a fixed year-slot ("CSE Year 2 Section A") that a different
// cohort of students occupies each session (see Section.batch's own
// doc-comment) - its TimetableSlots/TimetableDraft need this stamped on them
// (see timetable/publish/route.ts) so a NEW cohort's published timetable
// never silently deletes or gets confused with the PREVIOUS cohort's, and so
// Timetable History can tell them apart.
// Pure date-only fallback, used directly only by the one genuinely
// synchronous, no-Firestore-at-hand caller (TimetableHistoryPanel.tsx, a
// read-only session-picker filter) - every write/read path that has a `db`
// and `collegeId` in scope should call resolveTimetableAcademicYear below
// instead, so a Principal's override (see resolveCurrentAcademicYear) is
// actually honored.
export function currentTimetableAcademicYear(
  now: Date = new Date(),
  start: AcademicYearStart = DEFAULT_ACADEMIC_YEAR_START
): string {
  return academicSessionLabel(currentAcademicStartYear(now, start));
}

// Override-aware counterpart to currentTimetableAcademicYear, in the same
// short "2026-27" shape every timetable/teaching-assignment/leave/holiday
// caller already stores and compares against (so no downstream comparison
// changes shape). `storedCurrentLabel` is whichever academicSessions doc has
// isCurrent:true (same doc resolveCurrentAcademicYear reads, just in short
// form here) - pass null/undefined when none exists yet, which falls back to
// today's pure date math exactly as before this function existed.
export function resolveTimetableAcademicYear(
  storedCurrentLabel?: string | null,
  now: Date = new Date(),
  start: AcademicYearStart = DEFAULT_ACADEMIC_YEAR_START
): string {
  const stored = parseAcademicYearStart(storedCurrentLabel);
  return stored != null ? academicSessionLabel(stored) : currentTimetableAcademicYear(now, start);
}

// Same null-tolerant convention as lib/college/semester.ts's
// matchesCurrentSemester: absent on the item (legacy data, or the current
// session's own slots before this field existed) always matches, so nothing
// already in Firestore is silently hidden the moment this field starts being
// stamped going forward.
export function matchesCurrentAcademicYear(itemYear: string | null | undefined, currentYear: string): boolean {
  return itemYear == null || itemYear === currentYear;
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

/**
 * Display-only: renders a "2025-26"/"2025-2026" session label as a
 * DD/MM/YYYY-DD/MM/YYYY date range (fixed to the same April 1 - March 31
 * cutoff currentAcademicStartYear already assumes everywhere else). Storage
 * and comparisons (AcademicSession.label, matchesCurrentAcademicYear, every
 * Firestore doc stamped with an academicYear string, etc.) are untouched and
 * keep using the short/long year-pair shape - only what's shown to a person
 * changes. Falls back to the original string unchanged if it isn't a
 * recognizable year-pair label (e.g. legacy free text).
 */
export function academicYearDateRangeLabel(label: string): string {
  const start = parseAcademicYearStart(label);
  if (start == null) return label;
  return `01/04/${start}-31/03/${start + 1}`;
}

/** "2026-06-01" -> "01/06/2026". Empty for anything that isn't a date. */
export function displayDate(iso: string | undefined | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * What to show for a session: the dates the Principal actually entered when
 * there are any, and the assumed April-March range otherwise. The assumed one
 * is a guess - a college running June-May was always shown 01/04-31/03 and
 * had no way to say otherwise - so a session carrying real dates must never
 * fall back to it.
 */
export function sessionRangeLabel(
  session: { label: string; startDate?: string; endDate?: string } | null | undefined,
  fallbackLabel?: string
): string {
  if (session?.startDate && session.endDate) {
    return `${displayDate(session.startDate)}-${displayDate(session.endDate)}`;
  }
  return academicYearDateRangeLabel(session?.label ?? fallbackLabel ?? "");
}

/**
 * The short label a date range belongs to, taken from the year the range
 * STARTS in - so 2026-06-01 to 2027-05-31 is "2026-27", the same shape every
 * consumer already compares against. This is what keeps arbitrary dates and
 * the existing label-keyed comparisons compatible.
 */
export function sessionLabelForRange(startISO: string): string | undefined {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec((startISO ?? "").trim());
  return m ? academicSessionLabel(Number(m[1])) : undefined;
}
