// Continuous Evaluation Assessment (CEA) - R26 onward. Every unit of a subject has one assessment worth
// `unitMarks` (10); its type (written test, assignment, presentation ...) and when it happens are the
// Subject Department's plan. A unit "with Mid n" is a separate written paper in that Mid's sitting, set by the
// Mid paper setter; an "in class" unit is run by the section's faculty, who enter marks only. The unit marks
// add up and scale to the max of the internal-marks component the Exam Cell links to CEA (its weight).

/** colleges/{c}/ceaSettings/{courseKey}__{REGULATION} - Exam Cell, per course + regulation. */
export interface CeaSettings {
  id: string;
  courseKey: string;
  courseName: string;
  regulation: string;
  enabled: boolean;
  unitMarks: number;                       // marks of each unit's assessment (10)
  types: { id: string; label: string }[];  // WRITTEN is always there (a with-Mid unit is a written test)
  paperMinutes: number;                    // time of a with-Mid CIE paper (taken out of the Mid sitting)
  version: number;
  updatedAt?: string;
  updatedByName?: string;
}

export type CeaWhen = "CLASS" | `MID${number}`;

export interface CeaPlanUnit {
  unit: number;
  title: string;      // from the frozen syllabus (display copy)
  typeId: string;
  when: CeaWhen;
}

/** colleges/{c}/ceaPlans/{subjectId} - the Subject Department HOD's plan for a subject (every branch). */
export interface CeaPlan {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  courseKey: string;
  regulation: string;
  units: CeaPlanUnit[];
  version: number;
  updatedAt: string;
  updatedByName: string;
  history: { at: string; byName: string; change: string }[];
}

export interface CeaMarkEntry {
  studentId: string;
  rollNumber: string;
  name: string;
  marks: number | null;                              // out of the unit's marks; absent = 0
  absent?: boolean;
  questionMarks?: Record<string, number | null>;     // a with-Mid unit entered question by question
}

/** colleges/{c}/ceaMarks/{assignmentId}__U{unit} - one unit's marks for one section's teaching assignment. */
export interface CeaMarksSheet {
  id: string;
  assignmentId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  department: string;
  sectionId?: string;
  sectionName: string;
  courseId: string;
  year?: number;
  facultyId: string;                                 // facultyMembers id
  facultyName: string;
  unit: number;
  typeId: string;
  typeLabel: string;
  when: CeaWhen;
  unitMarks: number;
  heldOn?: string;                                   // YYYY-MM-DD (in-class units)
  status: "DRAFT" | "SUBMITTED";
  entries: CeaMarkEntry[];
  totalStudents: number;
  enteredCount: number;
  rev: number;
  submittedAt?: string;
  updatedAt: string;
  updatedByName: string;
}
