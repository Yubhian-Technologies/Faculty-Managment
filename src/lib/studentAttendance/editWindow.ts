import type { Firestore } from "firebase-admin/firestore";
import type { CourseYearTiming } from "@/types";
import { isManualEditWindowOpen } from "@/lib/attendance/attendanceWindow";
import { loadEffectiveTiming, resolveCurrentSemester } from "@/lib/college/semester";

// When the Department Office may post or correct STUDENT attendance after the fact.
//
// Staff attendance keeps its own "current month, up to the 25th" rule (attendanceWindow.ts). For students a
// record may also be corrected for the whole SEMESTER it belongs to: a date is editable while it falls in the
// same semester (per the course-year's configured semester dates) as today. The old month rule still applies on
// top, so this is never narrower than before; a course-year with no semesters configured keeps only the month rule.

export const STUDENT_EDIT_WINDOW_CLOSED_MESSAGE =
  "Student attendance can only be corrected during the semester it belongs to (or for the current month, up to the 25th). This semester has ended, so the record is view-only.";

export function studentEditWindowOpen(
  recordDate: Date,
  timing: Pick<CourseYearTiming, "semesters"> | null | undefined,
  now: Date = new Date()
): boolean {
  if (isManualEditWindowOpen(recordDate, now)) return true;
  const recordSemester = resolveCurrentSemester(timing, recordDate);
  return recordSemester != null && recordSemester === resolveCurrentSemester(timing, now);
}

/** Same rule for a stored session: resolves its section's course-year timing (only when the month rule is closed). */
export async function isStudentAttendanceEditOpen(
  db: Firestore,
  collegeId: string,
  session: { sectionId?: string; year?: number },
  recordDate: Date,
  now: Date = new Date()
): Promise<boolean> {
  if (isManualEditWindowOpen(recordDate, now)) return true;
  if (!session.sectionId || session.year == null) return false;
  const section = await db.collection("colleges").doc(collegeId).collection("sections").doc(session.sectionId).get();
  const courseId = (section.data() as { courseId?: string } | undefined)?.courseId;
  if (!courseId) return false;
  return studentEditWindowOpen(recordDate, await loadEffectiveTiming(db, collegeId, courseId, session.year), now);
}
