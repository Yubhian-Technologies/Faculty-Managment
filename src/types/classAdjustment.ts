import type { DayOfWeek } from "./teaching";

// "Adjust / Swap a Class" (faculty present, no leave): a faculty member hands one of their periods on a day to a
// colleague who also teaches that section, and the colleague teaches THEIR OWN subject in it (attendance is recorded
// under the colleague's own teaching assignment). A swap is two such hand-overs on the same day, each way.
// Stored at colleges/{c}/classAdjustments/{id}; read by lib/classAdjustments (who teaches which period that day).

export type ClassAdjustmentKind = "ADJUST" | "SWAP";
// PENDING = asked, waiting for the colleague; ACCEPTED = in force; DECLINED / CANCELLED = never applies.
export type ClassAdjustmentStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED";

/** One period handed from one faculty member to another for one date. */
export interface ClassAdjustmentLeg {
  /** The timetable slot given away (the giver's own period). */
  slotId: string;
  day: DayOfWeek;
  periodNumber: number;
  startTime?: string;
  endTime?: string;
  // Snapshot of the slot's placement (so the period still resolves if the timetable is republished).
  department: string;
  courseId: string;
  year: number;
  semester?: number;
  sectionId: string;
  sectionName: string;
  classroom?: string;
  /** Giver (facultyMembers doc id) and what they would have taught. */
  fromFacultyId: string;
  fromFacultyName: string;
  fromAssignmentId: string;
  fromSubjectId: string;
  fromSubjectName: string;
  /** Taker and their OWN teaching assignment in the same section (taught and recorded instead). */
  toFacultyId: string;
  toFacultyName: string;
  toAssignmentId: string;
  toSubjectId: string;
  toSubjectName: string;
}

export interface ClassAdjustment {
  id?: string;
  kind: ClassAdjustmentKind;
  /** "YYYY-MM-DD" (IST). A swap's two periods are on this same day. */
  date: string;
  status: ClassAdjustmentStatus;
  /** The faculty member whose class is adjusted (asks), and the colleague (accepts). facultyMembers ids. */
  requesterFacultyId: string;
  requesterName: string;
  counterpartFacultyId: string;
  counterpartName: string;
  /** Both of the above - for "mine" lists (array-contains). */
  facultyIds: string[];
  /** Departments of the sections involved - for the HOD's list. */
  departmentNames: string[];
  /** legs[0] = requester's period -> counterpart; legs[1] (SWAP) = counterpart's period -> requester. */
  legs: ClassAdjustmentLeg[];
  reason?: string;
  createdByUid: string;
  createdByName: string;
  /** HOD = arranged by the HOD (in force at once); FACULTY = asked by the requester (needs the colleague's accept). */
  createdBy: "FACULTY" | "HOD";
  respondedAt?: unknown;
  respondedByName?: string;
  declineReason?: string;
  cancelledAt?: unknown;
  cancelledByName?: string;
  cancelReason?: string;
  createdAt: unknown;
  updatedAt: unknown;
}
