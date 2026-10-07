import { calcPercent } from "./percentage";

export interface SubjectFilterRow {
  subjectId: string;
  held: number;
  attended: number;
  percent: number | null;
}

export interface SubjectFilters {
  /** Restrict to these subjects; null = every subject. */
  subjectIds: string[] | null;
  /** Only subjects below the shortage threshold. */
  shortageOnly: boolean;
  minPercent: number | null;
  maxPercent: number | null;
}

export const NO_SUBJECT_FILTERS: SubjectFilters = { subjectIds: null, shortageOnly: false, minPercent: null, maxPercent: null };

export function hasSubjectFilters(f: SubjectFilters): boolean {
  return f.subjectIds != null || f.shortageOnly || f.minPercent != null || f.maxPercent != null;
}

/** A subject with no classes held has no percentage, so an active % bound or shortage filter leaves it out. */
export function filterSubjectRows<R extends SubjectFilterRow>(rows: R[], f: SubjectFilters, threshold: number): R[] {
  return rows.filter((r) => {
    if (f.subjectIds && !f.subjectIds.includes(r.subjectId)) return false;
    if (f.shortageOnly && !(r.percent != null && r.percent < threshold)) return false;
    if (f.minPercent != null && (r.percent == null || r.percent < f.minPercent)) return false;
    if (f.maxPercent != null && (r.percent == null || r.percent > f.maxPercent)) return false;
    return true;
  });
}

/** Held / attended / % over exactly the rows shown. */
export function totalOfRows(rows: SubjectFilterRow[]): { held: number; attended: number; percent: number | null } {
  const held = rows.reduce((n, r) => n + r.held, 0);
  const attended = rows.reduce((n, r) => n + r.attended, 0);
  return { held, attended, percent: calcPercent(attended, held) };
}
