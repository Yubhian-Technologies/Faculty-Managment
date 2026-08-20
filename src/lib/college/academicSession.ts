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

/** "2024-2028" -> 2024 (the intake/start year). Null if the label doesn't start with a 4-digit year. */
function parseBatchStartYear(batch: string): number | null {
  const m = batch.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/**
 * Every intake year a regulation's batch field covers. One regulation commonly
 * runs for several consecutive intakes ("2024-2028,2025-2029" - R23 governing
 * both the 2024 and 2025 admissions), so the field is a comma-separated list
 * and each entry contributes its own start year.
 *
 * Previously only the first entry was read, which meant a second batch typed
 * after a comma was stored but never took effect - the regulation simply
 * didn't resolve for that cohort's year.
 */
export function parseBatchStartYears(batch: string): number[] {
  return batch
    .split(",")
    .map((part) => parseBatchStartYear(part.trim()))
    .filter((y): y is number => y != null);
}

// Which regulation code governs ordinal course-year `courseYear` (1-based -
// 1st Year, 2nd Year, ...) AS OF a given session, derived purely from each
// regulation's own Batch (intake range, e.g. "2024-2028" - see
// AcademicRegulationSettings.regulationBatches) versus that session, with no
// per-course configuration needed at all. A batch starting in year Y sits in
// ordinal year `asOfStartYear - Y + 1` for the session starting `asOfStartYear`;
// this returns every regulation whose batch computes to exactly `courseYear`
// for that session - normally exactly one, since each admission year has its
// own regulation, but callers should treat more than one as "ambiguous, ask
// the Principal to fix the batches" rather than silently picking the first.
// `asOfStartYear` defaults to the real current session (unchanged from
// before this param existed) - dean/subjects/page.tsx passes its own
// Academic Year selector's session instead, so a Dean can browse which
// regulation covered a year in a past or future session, not just today's.
// Used by dean/subjects/page.tsx only - other pages (HOD Subjects, Sections)
// still use the older, per-course Course Catalog regulationYears mechanism
// (see regulationsForYear in academicStructure.ts).
export function regulationsForCourseYearByBatch(
  regulationBatches: Record<string, string>,
  courseYear: number,
  asOfStartYear: number = currentAcademicStartYear(),
): string[] {
  const matches: string[] = [];
  for (const [code, batch] of Object.entries(regulationBatches)) {
    // Any one of the regulation's batches landing on this course-year is
    // enough - they're consecutive intakes of the same regulation, so at most
    // one of them can occupy a given year in a given session anyway.
    const hit = parseBatchStartYears(batch).some((start) => asOfStartYear - start + 1 === courseYear);
    if (hit) matches.push(code);
  }
  return matches;
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
// NOTE: pure date-only resolution, unlike resolveCurrentAcademicYear below
// (which honors a Principal-configured override) - the timetable/subject
// callers of this are synchronous and don't have that stored setting loaded.
// Worth reconciling the two later if a college's session ever needs to
// diverge from the April cutoff for timetable purposes too.
export function currentTimetableAcademicYear(now: Date = new Date()): string {
  return academicSessionLabel(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);
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
