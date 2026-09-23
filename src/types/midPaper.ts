import type { Timestamp } from "firebase/firestore";

// ─── Mid Paper Setter ───────────────────────────────────────────────────────
// An HOD assigns one faculty (from whoever currently teaches a subject, per
// teachingAssignments) to prepare a Mid's question bank for it. Doc id is
// deterministic (`${subjectId}_mid${midNumber}`) so re-assigning the same
// subject+mid just overwrites who holds it - one holder at a time, no
// separate "remove" step needed.
//
// Faculty-side question submission (min 10 required questions, any beyond
// that optional, no two identical) is not built yet - this is the
// assignment step only. `status` stays "ASSIGNED" until that exists.

export type MidNumber = 1 | 2;
export type MidPaperAssignmentStatus = "ASSIGNED";

export interface MidPaperAssignment {
  id: string;
  collegeId: string;
  department: string;
  courseId?: string;
  courseName?: string;
  year: number;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  midNumber: MidNumber;
  facultyId: string;
  facultyName: string;
  assignedBy: string;
  assignedByName: string;
  status: MidPaperAssignmentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
