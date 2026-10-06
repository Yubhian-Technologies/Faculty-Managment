import type { Firestore } from "firebase-admin/firestore";
import { istDateKey, istTimeHHMM } from "./istTime";

// Who may post or correct STUDENT attendance after the fact, and when.
//
//   - The HOD: always, for their own department.
//   - A Department Office head: only if their HOD switched it on
//     (departmentOfficeAccess/{department}.editStudentAttendance). Off by default,
//     so the office head - who otherwise holds the HOD's authority - gets this one
//     only by the HOD's explicit choice.
//   - When: once the faculty's own posting window has closed - any earlier day, or
//     today after that course-year's college end time. Never while the faculty can
//     still post it themselves.

export const OFFICE_ATTENDANCE_DENIED_MESSAGE =
  "The Head of Department hasn't enabled student-attendance editing for the Department Office.";
export const FACULTY_WINDOW_OPEN_MESSAGE =
  "The faculty member can still post this themselves - it can be edited here for a past day, or today once the college day has ended.";

export const officeAccessRef = (db: Firestore, collegeId: string, department: string) =>
  db.collection("colleges").doc(collegeId).collection("departmentOfficeAccess").doc(encodeURIComponent(department));

export async function officeMayEditAttendance(db: Firestore, collegeId: string, department: string): Promise<boolean> {
  if (!department) return false;
  const snap = await officeAccessRef(db, collegeId, department).get();
  return (snap.data() as { editStudentAttendance?: boolean } | undefined)?.editStudentAttendance === true;
}

/**
 * True when a Department Office head must be refused: they are one, and none of the
 * departments they serve has the HOD's permission switched on. Always false for an HOD.
 */
export async function departmentOfficeBlocked(
  db: Firestore,
  collegeId: string,
  session: { realRole?: string },
  ownDepartmentNames: string[]
): Promise<boolean> {
  if (session.realRole !== "DEPARTMENT_OFFICE") return false;
  for (const name of ownDepartmentNames) {
    if (await officeMayEditAttendance(db, collegeId, name)) return false;
  }
  return true;
}

/**
 * Whether the faculty's own window to post this period is over: the date is before
 * today (IST), or it is today and the close time ("HH:MM") has passed. With no close
 * time known, today counts as still open.
 */
export function facultyWindowClosed(dateISO: string, closeTime: string | undefined, now: Date = new Date()): boolean {
  const today = istDateKey(now);
  if (dateISO < today) return true;
  if (dateISO > today) return false;
  return !!closeTime && istTimeHHMM(now) >= closeTime;
}
