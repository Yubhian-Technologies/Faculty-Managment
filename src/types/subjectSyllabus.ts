import type { CourseOutcome, OutcomeMapping, SyllabusUnit } from "./midQuestionBank";

// ─── Subject syllabus (HOD prepares, Academics freezes) ─────────────────────
// colleges/{c}/subjectSyllabus/{subjectId} - one per master subject, for every branch it is taught in: the units,
// the Course Outcomes (each in a unit) and the CO -> PO/PSO ticks. Prepared by the HOD of the subject's Subject
// Department, submitted to Academics (Dean Academics), who freezes it or returns it with remarks. Once frozen only
// Academics edits it, and every change is kept in `history` (when, who, what: old -> new). Faculty preparing Mid
// question banks / papers use the FROZEN syllabus (bank `outcomesId` = `syllabus__{subjectId}`); the syllabus PDF
// itself stays on the subject (`syllabusUrl`).

export type SubjectSyllabusStatus = "DRAFT" | "SUBMITTED" | "FROZEN" | "RETURNED";

export interface SyllabusFieldChange {
  /** What changed, in words ("Unit 2 title", "CO3 statement", "CO1 -> POs", "Syllabus PDF"). */
  field: string;
  before: string;
  after: string;
}

export interface SyllabusHistoryEntry {
  at: string;
  byUid: string;
  byName: string;
  /** HOD | ACADEMICS (the role that acted). */
  role: string;
  action: "SAVED" | "SUBMITTED" | "FROZEN" | "RETURNED" | "EDITED_AFTER_FREEZE" | "PDF_CHANGED";
  remarks?: string;
  /** Edits after the freeze (and the PDF): exactly what moved. */
  changes?: SyllabusFieldChange[];
}

export interface SubjectSyllabus {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  courseName: string;
  regulation: string;
  units: SyllabusUnit[];
  /** Every CO carries its `unit`. */
  cos: CourseOutcome[];
  mapping: OutcomeMapping;
  status: SubjectSyllabusStatus;
  /** Bumped on every save / step; a save names the version it edited (409 otherwise). */
  version: number;
  /** Remarks of the latest return. */
  returnRemarks?: string | null;
  submittedAt?: string | null;
  submittedByName?: string | null;
  frozenAt?: string | null;
  frozenByName?: string | null;
  updatedAt: string;
  updatedByUid: string;
  updatedByName: string;
  /** Oldest first, capped (see HISTORY_MAX). */
  history: SyllabusHistoryEntry[];
}
