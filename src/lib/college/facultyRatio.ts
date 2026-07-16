// Shared 1:15 student-faculty ratio + 1:2:6 cadre split, used by the hiring
// vacancy-sizing route (faculty-requirement) and referenced (non-blockingly)
// when HOD/Principal assign faculty to sections/subjects, so section staffing
// stays visible against the same ratio the hiring pipeline targets.

export const STUDENT_FACULTY_RATIO = 15; // 1 faculty per 15 students
export const CADRE_PARTS = { prof: 1, assoc: 2, asst: 6 } as const; // 1:2:6
export const CADRE_TOTAL_PARTS = CADRE_PARTS.prof + CADRE_PARTS.assoc + CADRE_PARTS.asst; // 9

export function requiredFacultyCount(totalStudents: number): number {
  return totalStudents > 0 ? Math.ceil(totalStudents / STUDENT_FACULTY_RATIO) : 0;
}
