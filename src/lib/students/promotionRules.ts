import type { Section, StudentRecord } from "@/types";

// Pure rules for students/promote, kept out of the route so they can be tested
// and so the route reads as orchestration. Each returns null when the student
// may proceed, or a short human reason for skipping them. A skipped student is
// simply left as they were - never half-moved.

type PromotableStudent = Pick<StudentRecord, "year" | "section" | "department" | "secondaryDepartment" | "courseId">;

/** The student must really be in the section the cohort is being moved out of. */
export function notInSourceSection(student: PromotableStudent, source: Section | null): string | null {
  if (!source) return null;
  if (student.section !== source.name || student.year !== source.year) {
    return `not in ${source.name} (Year ${source.year})`;
  }
  const dept = student.department === source.department || student.secondaryDepartment === source.department;
  if (!dept) return `not in ${source.department}`;
  // Deliberately NOT compared on courseId: a student's own courseId can be stale
  // on records written before placement started keeping it in step (see the
  // promote route's note), and refusing a real section member for that would
  // block a legitimate cohort.
  return null;
}

/**
 * A PROMOTE moves a student up exactly one year, within the same programme.
 * `catalogOf` resolves a Course document id to its catalog programme (courses
 * of different departments that run the same programme share one catalogId); an
 * unknown programme on either side skips the check rather than blocking.
 */
export function invalidPromotion(
  student: PromotableStudent,
  target: Pick<Section, "year" | "courseId">,
  catalogOf: (courseId: string | undefined) => string | undefined
): string | null {
  if (target.year !== student.year + 1) {
    return `Year ${student.year} student can only be promoted into a Year ${student.year + 1} section (target is Year ${target.year})`;
  }
  const from = catalogOf(student.courseId);
  const to = catalogOf(target.courseId);
  if (from && to && from !== to) return "target section is for a different programme";
  return null;
}

/** A GRADUATE completes the programme, so the student must be in its final year. */
export function notInFinalYear(student: Pick<StudentRecord, "year">, finalYear: number | undefined): string | null {
  if (!finalYear) return null;
  if (student.year !== finalYear) return `Year ${student.year} is not the final year (Year ${finalYear})`;
  return null;
}
