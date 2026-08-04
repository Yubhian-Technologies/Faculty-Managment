import type { Firestore } from "firebase-admin/firestore";

// Builds the ref/data pair for a new department-history entry, written
// alongside every student create and every promotion (see
// StudentDepartmentHistoryEntry for the append-only shape/rationale).
export function departmentHistoryEntry(
  db: Firestore,
  collegeId: string,
  studentId: string,
  department: string,
  section: string,
  year: number,
  now: Date
) {
  return {
    ref: db
      .collection("colleges").doc(collegeId)
      .collection("students").doc(studentId)
      .collection("departmentHistory").doc(),
    data: { department, section, year, from: now },
  };
}
