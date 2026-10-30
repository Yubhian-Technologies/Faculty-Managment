// Incident reports - College Office → My Work → Incident Report. Stored at
// colleges/{collegeId}/incidentReports/{id}. The affected individuals are a
// snapshot taken when the report is saved, so a later edit to a student's or
// faculty member's record never rewrites what was reported.

export type IncidentAffectedType = "STUDENT" | "FACULTY" | "BOTH";

export interface IncidentStudent {
  id: string;
  name: string;
  rollNumber: string;
  course: string;
  department: string;
  year: number | null;
}

export interface IncidentFaculty {
  id: string;
  name: string;
  employeeId: string;
  department: string;
}

export interface IncidentReport {
  id: string;
  collegeId: string;
  incidentDate: string; // yyyy-mm-dd
  title: string;
  description: string;
  affectedType: IncidentAffectedType;
  students: IncidentStudent[];
  faculty: IncidentFaculty[];
  createdBy: string;
  createdByName: string;
  createdAt: string; // ISO timestamp (serialised by the API)
  // Only on the read-only Incident Record inbox: true until the signed-in
  // viewer has opened this report. Never stored on the report itself (the
  // stored `viewedBy` uid list stays server-side).
  unread?: boolean;
}
