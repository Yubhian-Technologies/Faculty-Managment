import { calcPercent } from "./percentage";

export interface FilterableStudent {
  labBatch?: string;
  absentDays?: number;
  bySubject: Record<string, { held: number; attended: number }>;
}

export interface StudentReportFilters {
  /** Only students with at least one missed period. */
  absentees: boolean;
  /** Restrict to these subjects (and compute % over just them); null = every subject. */
  subjectIds: string[] | null;
  /** Lab batches to keep, "" meaning not assigned to one; null = every batch. */
  batches: string[] | null;
  minPercent: number | null;
  maxPercent: number | null;
  /** Absent for at least this many whole days. */
  minAbsentDays: number | null;
}

export const NO_FILTERS: StudentReportFilters = {
  absentees: false, subjectIds: null, batches: null, minPercent: null, maxPercent: null, minAbsentDays: null,
};

export interface ShownTally { held: number; attended: number; percentage: number | null }

/** Held/attended/% over the chosen subjects (all of them when none are chosen). */
export function tallyForSubjects(s: FilterableStudent, subjectIds: string[] | null): ShownTally {
  let held = 0;
  let attended = 0;
  for (const [id, v] of Object.entries(s.bySubject)) {
    if (subjectIds && !subjectIds.includes(id)) continue;
    held += v.held;
    attended += v.attended;
  }
  return { held, attended, percentage: calcPercent(attended, held) };
}

/**
 * Applies every active filter, each narrowing the result further. A student
 * with no classes held in the chosen subjects/range has no percentage, so an
 * active % bound leaves them out rather than guessing 0 or 100.
 */
export function applyStudentFilters<S extends FilterableStudent>(
  students: S[],
  f: StudentReportFilters
): (S & { shown: ShownTally })[] {
  return students
    .map((s) => ({ ...s, shown: tallyForSubjects(s, f.subjectIds) }))
    .filter((s) => {
      if (f.absentees && !(s.shown.held > s.shown.attended)) return false;
      if (f.batches && !f.batches.includes(s.labBatch ?? "")) return false;
      if (f.minPercent != null && (s.shown.percentage == null || s.shown.percentage < f.minPercent)) return false;
      if (f.maxPercent != null && (s.shown.percentage == null || s.shown.percentage > f.maxPercent)) return false;
      if (f.minAbsentDays != null && (s.absentDays ?? 0) < f.minAbsentDays) return false;
      return true;
    });
}
