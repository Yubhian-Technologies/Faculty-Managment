// Client-side filters for the Faculty Profile Completion report (FacultyProfileCompletionView): Designation and a
// Completion % range the person types. Pure functions over the rows already loaded - no stored data is read or changed.
import { designationKey, designationLabel } from "@/lib/designations/config";

export interface CompletionFilters {
  /** designationKey of the picked designation, "" = all */
  designation: string;
  /** as typed: "" = no lower bound */
  minPercent: string;
  /** as typed: "" = no upper bound */
  maxPercent: string;
}

export const NO_COMPLETION_FILTERS: CompletionFilters = { designation: "", minPercent: "", maxPercent: "" };

interface FilterableRow { designation?: string; overallPercent: number }

/** A typed percentage -> 0..100, or null when blank / not a number (that bound is then ignored). */
export function parsePercent(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

export function hasActiveCompletionFilters(f: CompletionFilters): boolean {
  return !!f.designation || parsePercent(f.minPercent) !== null || parsePercent(f.maxPercent) !== null;
}

/** True when both bounds are typed and the lower one is above the upper one (nothing could match). */
export function isPercentRangeBackwards(f: CompletionFilters): boolean {
  const min = parsePercent(f.minPercent);
  const max = parsePercent(f.maxPercent);
  return min !== null && max !== null && min > max;
}

export function filterCompletionRows<T extends FilterableRow>(rows: T[], f: CompletionFilters): T[] {
  const min = parsePercent(f.minPercent);
  const max = parsePercent(f.maxPercent);
  return rows.filter((r) => {
    // Compared by designationKey, so a legacy code (ASSISTANT_PROFESSOR) and a typed name ("Assistant Professor") are one designation.
    if (f.designation && designationKey(r.designation) !== f.designation) return false;
    if (min !== null && r.overallPercent < min) return false;
    if (max !== null && r.overallPercent > max) return false;
    return true;
  });
}

/** The designations present in the loaded rows, one per meaning, sorted by their display label. */
export function completionDesignationOptions(rows: FilterableRow[]): { value: string; label: string }[] {
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const key = designationKey(r.designation);
    if (key && !byKey.has(key)) byKey.set(key, designationLabel(r.designation));
  }
  return [...byKey.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
