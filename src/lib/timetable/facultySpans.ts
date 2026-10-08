import type { TimetableSlot } from "@/types";

/**
 * Wide cells for one day of a faculty's own Teaching Load grid. Same rule as the
 * class timetable (a period merges into the next only when its slots carry
 * `mergeWithNext`), but a merge never runs across a lunch/short break: the part
 * before the break stays one cell, the rest starts a new one. The match with the
 * next period is by subject + lab batch only - a faculty only sees their own
 * slots, so a room or substitute difference must not break the merge.
 * `breakAfter(slot)` returns the periods a break follows for that slot's course-year.
 */
export function facultySpans(
  periods: number[],
  slotsAt: (period: number) => TimetableSlot[],
  breakAfter: (slot: TimetableSlot) => Set<number>,
): { spans: Map<number, number>; skipped: Set<number> } {
  const spans = new Map<number, number>();
  const skipped = new Set<number>();
  for (let i = 0; i < periods.length; i++) {
    if (skipped.has(i)) continue;
    // A cell can hold two labs: anchor on the one that is flagged to merge.
    const here = slotsAt(periods[i]);
    const anchor = here.find((s) => s.mergeWithNext) ?? here[0];
    if (!anchor) continue;
    const breaks = breakAfter(anchor);
    let j = i + 1;
    while (j < periods.length) {
      const prev = periods[j - 1];
      if (periods[j] !== prev + 1 || breaks.has(prev)) break;
      if (!slotsAt(prev).some((s) => s.mergeWithNext && s.subjectId === anchor.subjectId)) break;
      const next = slotsAt(periods[j]);
      if (!next.some((s) => s.subjectId === anchor.subjectId && (s.labBatch ?? "") === (anchor.labBatch ?? ""))) break;
      j++;
    }
    if (j - i > 1) {
      spans.set(i, j - i);
      for (let k = i + 1; k < j; k++) skipped.add(k);
    }
  }
  return { spans, skipped };
}
