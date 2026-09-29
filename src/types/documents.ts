import type { Timestamp } from "firebase/firestore";

// ─── Faculty Document ─────────────────────────────────────────────────────────

export type DocumentCategory =
  | "IDENTITY"
  | "QUALIFICATION"
  | "EXPERIENCE"
  | "APPOINTMENT"
  | "PAY_SLIP"
  | "CERTIFICATE"
  | "RESEARCH"
  | "OTHER";

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  IDENTITY: "Identity Document",
  QUALIFICATION: "Educational Qualification",
  EXPERIENCE: "Experience Certificate",
  APPOINTMENT: "Appointment / Offer Letter",
  PAY_SLIP: "Pay Slip",
  CERTIFICATE: "Training / Achievement Certificate",
  RESEARCH: "Research Paper / Publication",
  OTHER: "Other",
};

export interface FacultyDocument {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  category: DocumentCategory;
  name: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  uploadedBy: string;           // uid (can be the faculty themselves or admin)
  isVerified: boolean;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: Timestamp;
  expiryDate?: Timestamp;       // for docs like medical fitness, police clearance
  remarks?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Student Document ───────────────────────────────────────────────────────
// colleges/{collegeId}/studentDocuments/{docId} - a top-level collection
// (not a per-student subcollection like students/{id}/departmentHistory)
// because College Office needs a cross-student "recently uploaded" browse
// view, which a flat collection + `studentId` field supports with a plain
// query. `studentUid` is denormalized (set once at creation, never edited) so
// the Firestore rule for a student reading their OWN documents can match
// directly on request.auth.uid without a cross-document join.
export interface StudentDocument {
  id: string;
  collegeId: string;
  studentId: string;
  studentUid: string;
  title?: string;               // legacy-only: rows created before the type catalog existed
  documentType?: StudentDocumentType;
  customTypeLabel?: string;
  description?: string;
  fileName: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  uploadedByUid: string;
  uploadedByName: string;
  createdAt: Timestamp;
}

export type StudentDocumentType =
  | "BONAFIDE" | "STUDY_CERTIFICATE" | "STUDENT_STATUS" | "CONDUCT_CERTIFICATE"
  | "CHARACTER_CERTIFICATE" | "TRANSFER_CERTIFICATE" | "MIGRATION_CERTIFICATE"
  | "COURSE_COMPLETION" | "PROVISIONAL_CERTIFICATE" | "DEGREE_CERTIFICATE"
  | "CONSOLIDATED_MARKS_MEMO" | "SEMESTER_MARKS_MEMO" | "DUPLICATE_MARKS_MEMO"
  | "TRANSCRIPT" | "MOI_CERTIFICATE" | "NO_DUES_CERTIFICATE" | "ATTENDANCE_CERTIFICATE"
  | "INTERNSHIP_CERTIFICATE" | "NOC" | "RECOMMENDATION_LETTER"
  | "BONAFIDE_PASSPORT_VISA" | "BONAFIDE_BANK_LOAN" | "BONAFIDE_SCHOLARSHIP"
  | "GOVT_SCHEME_CERTIFICATE" | "FEE_CERTIFICATE" | "SCHOLARSHIP_FEE_CONCESSION"
  | "RANK_MERIT_CERTIFICATE" | "COURSE_VERIFICATION_LETTER" | "OTHER";

export const STUDENT_DOCUMENT_TYPE_LABELS: Record<StudentDocumentType, string> = {
  BONAFIDE: "Bonafide Certificate",
  STUDY_CERTIFICATE: "Study Certificate",
  STUDENT_STATUS: "Student Status / Enrollment Certificate",
  CONDUCT_CERTIFICATE: "Conduct Certificate",
  CHARACTER_CERTIFICATE: "Character Certificate",
  TRANSFER_CERTIFICATE: "Transfer Certificate (TC)",
  MIGRATION_CERTIFICATE: "Migration Certificate",
  COURSE_COMPLETION: "Course Completion Certificate",
  PROVISIONAL_CERTIFICATE: "Provisional Certificate",
  DEGREE_CERTIFICATE: "Degree Certificate",
  CONSOLIDATED_MARKS_MEMO: "Consolidated Marks Memo (CMM)",
  SEMESTER_MARKS_MEMO: "Semester Marks Memo",
  DUPLICATE_MARKS_MEMO: "Duplicate Marks Memo",
  TRANSCRIPT: "Transcript / Academic Transcript",
  MOI_CERTIFICATE: "Medium of Instruction (MOI) Certificate",
  NO_DUES_CERTIFICATE: "No Dues Certificate",
  ATTENDANCE_CERTIFICATE: "Attendance Certificate",
  INTERNSHIP_CERTIFICATE: "Internship / Training Certificate",
  NOC: "NOC (No Objection Certificate)",
  RECOMMENDATION_LETTER: "Recommendation / Verification Letter",
  BONAFIDE_PASSPORT_VISA: "Bonafide for Passport / Visa",
  BONAFIDE_BANK_LOAN: "Bonafide for Bank / Education Loan",
  BONAFIDE_SCHOLARSHIP: "Bonafide for Scholarship",
  GOVT_SCHEME_CERTIFICATE: "Certificate for Government Schemes / Benefits",
  FEE_CERTIFICATE: "Fee Payment / Fee Certificate",
  SCHOLARSHIP_FEE_CONCESSION: "Scholarship / Fee Concession Certificate",
  RANK_MERIT_CERTIFICATE: "Rank / Merit Certificate",
  COURSE_VERIFICATION_LETTER: "Course / Program Verification Letter",
  OTHER: "Other",
};

export function resolveStudentDocumentTypeLabel(
  doc: Pick<StudentDocument, "documentType" | "customTypeLabel" | "title">
): string {
  if (!doc.documentType) return doc.title || "Document"; // legacy rows uploaded before this catalog existed
  if (doc.documentType === "OTHER") return doc.customTypeLabel || "Other";
  return STUDENT_DOCUMENT_TYPE_LABELS[doc.documentType];
}
