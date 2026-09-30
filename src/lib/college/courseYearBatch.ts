import {
  admissionStartYearForCourseYear,
  deriveBatch,
  regulationsForCourseYearByBatch,
} from "./academicSession";

// What a department page shows for one year of a course: which intake batch
// is in that year during the college's current academic year, and which
// regulation that batch follows. Both are derived (same formulas Section
// batch defaults and the Teaching Assignments year picker already use), so
// they move forward by themselves when the college academic year rolls over.

export interface CourseYearBatchInfo {
  admissionYear: number;
  // "2024-28" - shown on screen.
  label: string;
  // "2024-2028" - the form Section.batch and regulationBatches store.
  longLabel: string;
  // Regulation code(s) covering this batch. Normally one; empty means no
  // regulation's batch coverage includes it, more than one means overlap.
  regulations: string[];
}

export function shortBatchLabel(startYear: number, endYear: number): string {
  return `${startYear}-${String(endYear % 100).padStart(2, "0")}`;
}

export function courseYearBatch(
  currentStartYear: number,
  courseYear: number,
  durationYears: number,
  catalog?: { regulations?: string[]; regulationBatches?: Record<string, string> } | null
): CourseYearBatchInfo {
  const admissionYear = admissionStartYearForCourseYear(currentStartYear, courseYear);
  const endYear = admissionYear + durationYears;
  return {
    admissionYear,
    label: shortBatchLabel(admissionYear, endYear),
    longLabel: deriveBatch(admissionYear, durationYears),
    regulations: catalog
      ? regulationsForCourseYearByBatch(catalog.regulationBatches ?? {}, courseYear, currentStartYear, catalog.regulations)
      : [],
  };
}
