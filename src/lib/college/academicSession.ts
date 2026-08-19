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

// This calendar academic session (e.g. "2026-27") - the year-over-year
// counterpart to lib/college/semester.ts's WITHIN-a-session semester concept.
// A Section is a fixed year-slot ("CSE Year 2 Section A") that a different
// cohort of students occupies each session (see Section.batch's own
// doc-comment) - its TimetableSlots/TimetableDraft need this stamped on them
// (see timetable/publish/route.ts) so a NEW cohort's published timetable
// never silently deletes or gets confused with the PREVIOUS cohort's, and so
// Timetable History can tell them apart.
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
