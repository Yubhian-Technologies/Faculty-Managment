import type { Firestore } from "firebase-admin/firestore";
import { istDateKey, istTimeHHMM } from "./istTime";

// Who may post or correct STUDENT attendance after the fact, and when.
//
//   - The HOD: always, for their own department.
//   - A Department Office head: only if their HOD switched it on
//     (departmentOfficeAccess/{department}.editStudentAttendance). Off by default,
//     so the office head - who otherwise holds the HOD's authority - gets this one
//     only by the HOD's explicit choice.
//   - When: once the period has ended - any earlier day, or today after that
//     period's own end time. Never while the period is still running.

export const OFFICE_ATTENDANCE_DENIED_MESSAGE =
  "The Head of Department hasn't enabled student-attendance editing for the Department Office.";
export const FACULTY_WINDOW_OPEN_MESSAGE =
  "This period hasn't ended yet - attendance can be edited here once it has, today or on any earlier day.";

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
 * Whether the period is over: the date is before today (IST), or it is today and the
 * period's end time ("HH:MM") has passed. With no end time known, today counts as
 * still running. (Name kept: it is the gate for office edits of that period.)
 */
export function facultyWindowClosed(dateISO: string, endTime: string | undefined, now: Date = new Date()): boolean {
  const today = istDateKey(now);
  if (dateISO < today) return true;
  if (dateISO > today) return false;
  return !!endTime && istTimeHHMM(now) >= endTime;
}
