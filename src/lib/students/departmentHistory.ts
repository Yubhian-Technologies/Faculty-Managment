import type { Firestore } from "firebase-admin/firestore";

// Builds the ref/data pair for a new department-history entry, written
// alongside every student create and every promotion (see
// StudentDepartmentHistoryEntry for the append-only shape/rationale).
//
// `previousSection` is optional and additive - every existing caller that
// omits it keeps writing exactly what it always has. Distribution passes it
// so a history entry can answer "what section did this student move FROM",
// which the entry's own new-state-only fields can't otherwise reconstruct
// without walking back through the subcollection's prior docs.
export function departmentHistoryEntry(
  db: Firestore,
  collegeId: string,
  studentId: string,
  department: string,
  section: string,
  year: number,
  now: Date,
  previousSection?: string
) {
  return {
    ref: db
      .collection("colleges").doc(collegeId)
      .collection("students").doc(studentId)
      .collection("departmentHistory").doc(),
    data: {
      department,
      section,
      year,
      from: now,
      ...(previousSection !== undefined ? { previousSection } : {}),
    },
  };
}
