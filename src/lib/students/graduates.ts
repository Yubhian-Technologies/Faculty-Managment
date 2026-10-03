// Shared by the server (students GET, `graduates=1`) and GraduatedStudentsView
// so the two can't drift: the same "Unspecified" bucket labels, the same
// Course -> Batch -> roll ordering, and the same notion of which course/batch a
// graduate belongs to.
//
// A graduate's programme and batch are snapshots written at the moment they
// were graduated (students/promote/route.ts) - a student graduated without a
// source section has neither, and falls into the "Unspecified" buckets.

export const UNSPECIFIED_COURSE = "Unspecified programme";
export const UNSPECIFIED_BATCH = "Unspecified batch";

interface GraduateLike {
  graduationCourseName?: string | null;
  graduationBatch?: string | null;
  rollNumber?: string | null;
}

export function graduateCourseLabel(s: GraduateLike): string {
  return s.graduationCourseName?.trim() || UNSPECIFIED_COURSE;
}

export function graduateBatchLabel(s: GraduateLike): string {
  return s.graduationBatch?.trim() || UNSPECIFIED_BATCH;
}

/**
 * Display order: course A-Z, then newest batch first within a course (the
 * group someone is most likely looking for right after a promotion run), then
 * roll number. Rows of one course/batch group are therefore contiguous, so
 * paging through this order keeps each group together.
 */
export function compareGraduates(a: GraduateLike, b: GraduateLike): number {
  return (
    graduateCourseLabel(a).localeCompare(graduateCourseLabel(b))
    || graduateBatchLabel(b).localeCompare(graduateBatchLabel(a))
    || (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "")
  );
}

/** Drop-down options: courses A-Z, batches newest first. */
export function graduateFacets(rows: GraduateLike[]): { courses: string[]; batches: string[] } {
  return {
    courses: Array.from(new Set(rows.map(graduateCourseLabel))).sort((a, b) => a.localeCompare(b)),
    batches: Array.from(new Set(rows.map(graduateBatchLabel))).sort((a, b) => b.localeCompare(a)),
  };
}
