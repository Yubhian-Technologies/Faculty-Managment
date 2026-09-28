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
  title: string;
  description?: string;
  fileName: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  uploadedByUid: string;
  uploadedByName: string;
  createdAt: Timestamp;
}
