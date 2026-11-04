import type { Timestamp } from "firebase/firestore";
import type { UserRole } from "./core";

// Certificate Management module - first certificate type is "No Due
// Certificate" (see src/lib/certifications/certificateTypes.ts for the
// hardcoded flow definition). The flow is a fixed prototype for now: HOD
// verification, then a parallel fan-out to Placement/Library/Hostel
// clearance, then College Office issuance. The shapes below are written to
// stay stable if a later phase makes the flow admin-configurable - nothing
// here hardcodes "HOD" or "LIBRARY" as special cases; those are just data
// produced by whichever source (code constant today, Firestore config
// later) resolves a RecipientResolver.

/** How a step/branch's "who can act" question resolves to concrete uids. */
export type RecipientResolver =
  | { kind: "ROLE"; role: UserRole }
  | { kind: "STUDENT_DEPARTMENT_HOD" }
  /** A named person (any login of the college). */
  | { kind: "USER"; uid: string; name: string }
  /** The student's assigned mentor. */
  | { kind: "STUDENT_MENTOR" }
  /** The faculty in-charge of the student's section. */
  | { kind: "CLASS_INCHARGE" };

export interface ParallelBranchDef {
  key: string;
  label: string;
  recipient: RecipientResolver;
}

export type FlowStepDef =
  | { id: string; type: "SEQUENTIAL"; label: string; recipient: RecipientResolver }
  | { id: string; type: "PARALLEL"; label: string; branches: ParallelBranchDef[] };

export interface CertificateTypeDef {
  key: "NO_DUE";
  label: string;
  flow: FlowStepDef[];
  issuer: RecipientResolver;
  templateKey: "NO_DUE";
}

// ─── Configurable certificates (Principal / College Admin) ─────────────────────
// colleges/{c}/certificateTypes/{id}, colleges/{c}/certificateTemplates/{id},
// colleges/{c}/certificateSettings/main (signatures), colleges/{c}/issuedCertificates/{id}
// (the register), certificateVerifications/{code} (root - the public QR check).

export type CertificateCategory = "IDENTITY" | "ACADEMIC_RECORDS" | "EXAMINATION" | "CLEARANCE" | "FEE_FINANCE" | "LETTERS";

/** A field on the student's request form, or one the issuer fills in at issue time (date of leaving, conduct ...). */
export interface CertificateFieldDef {
  key: string;
  label: string;
  kind: "text" | "textarea" | "date" | "number" | "select";
  options?: string[];
  required: boolean;
  /** Issuer fields only: a value used when the issuer leaves it blank ("Good" for conduct). */
  defaultValue?: string;
}

export interface CertificateAttachmentDef {
  key: string;
  label: string;
  required: boolean;
}

export interface CertificateTypeConfig {
  id: string;
  code: string; // "BON" - used in the certificate number
  name: string;
  category: CertificateCategory;
  description?: string;
  isActive: boolean;
  /** Who may request it. Empty = every student. */
  eligibility: { statuses: ("REGULAR" | "GRADUATED" | "DETAINED" | "DISCONTINUED")[]; years: number[] };
  purposes: string[]; // empty = no purpose asked
  allowOtherPurpose: boolean;
  fields: CertificateFieldDef[];
  attachments: CertificateAttachmentDef[];
  /** Issued at most once per student (a Transfer Certificate). */
  onceOnly: boolean;
  /** Fee shown to the student; the issuer confirms payment with a receipt number. 0 = free. */
  feeAmount: number;
  flow: FlowStepDef[];
  issuer: RecipientResolver;
  templateId: string;
  issuerFields: CertificateFieldDef[];
  /** "VIT/{CODE}/{YYYY}/{SEQ}" - {CODE}, {YYYY}, {AY} (2026-27) and {SEQ} (4 digits) are replaced. */
  numberFormat: string;
  signatureId?: string;
  delivery: "DIGITAL" | "PHYSICAL" | "BOTH";
  /** Seeded from the starter catalogue (which entry). */
  catalogKey?: string;
  updatedAt?: string;
  updatedByName?: string;
}

export type CertificateTemplateKind = "LETTER" | "FORM" | "MARKS" | "UPLOAD";

export interface CertificateTemplate {
  id: string;
  name: string;
  kind: CertificateTemplateKind;
  /** Heading on the certificate ("BONAFIDE CERTIFICATE"). */
  title: string;
  /** LETTER: the paragraph(s), with {{placeholders}}. */
  body?: string;
  /** FORM: numbered rows "label -> value" (the value may hold {{placeholders}}). */
  rows?: { label: string; value: string }[];
  /** MARKS: which statement. */
  marksKind?: "SEMESTER" | "CONSOLIDATED" | "TRANSCRIPT";
  /** Shown below the body (a note, "This certificate is issued on request ..."). */
  footer?: string;
  showQr: boolean;
  showPhoto?: boolean;
  catalogKey?: string;
  updatedAt?: string;
}

export interface CertificateSignature {
  id: string;
  name: string;
  designation: string; // "Principal"
  imageUrl: string;
}

export interface CertificateSettings {
  signatures: CertificateSignature[];
}

/** One issued certificate - the register (and what the QR check reads). */
export interface IssuedCertificate {
  id: string;
  requestId: string;
  certificateNumber: string;
  verificationCode: string;
  typeId: string;
  typeName: string;
  typeCode: string;
  studentId: string;
  studentName: string;
  studentRollNumber: string;
  studentDepartment: string;
  issuedAt: string;
  issuedByUid: string;
  issuedByName: string;
  /** Where the certificate is read: the frozen page (issuedCertificates/{id}/files/document) via the API, or the uploaded PDF. */
  documentUrl: string;
  /** UPLOAD templates: the PDF the issuer uploaded. */
  uploadedPdf?: boolean;
  feeReceiptNo?: string;
  revoked?: { at: string; byName: string; reason: string } | null;
}

export type CertificateRequestStatus = "IN_PROGRESS" | "PENDING_ISSUANCE" | "ISSUED" | "REJECTED" | "CANCELLED" | "RETURNED";

/** One PARALLEL step's branch state - a department's independent clearance decision. */
export interface CertificateClearance {
  branchKey: string;
  branchLabel: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  decidedByUid?: string;
  decidedByName?: string;
  // Timestamp once read back from Firestore; Date immediately after a
  // transaction writes it (same convention as the rest of this type).
  decidedAt?: Timestamp | Date;
  remarks?: string;
}

export type StepRuntimeState =
  | {
      type: "SEQUENTIAL";
      status: "PENDING" | "APPROVED" | "REJECTED";
      decidedByUid?: string;
      decidedByName?: string;
      decidedAt?: Timestamp | Date;
      remarks?: string;
    }
  | { type: "PARALLEL"; branches: CertificateClearance[] };

// Exam Cell's PC (Provisional Certificate) + CMM (Consolidated Marks Memo)
// task - seeded once the College Office's fee-check step approves, and
// resolved independently of the main flow/status: it runs in PARALLEL with
// the College Office generating the No-Due certificate PDF, never blocking
// or being blocked by issuance. A completion marker only for this phase - no
// PDF generated here, Exam Cell just confirms PC/CMM were issued.
export interface ExamCellTask {
  status: "PENDING" | "ISSUED";
  markedByUid?: string;
  markedByName?: string;
  markedAt?: Timestamp | Date;
}

export interface CertificateHistoryEntry {
  action: string;
  byUid: string;
  byName: string;
  byRole: string;
  at: Timestamp | Date;
  remarks?: string;
  detail?: string;
}

export interface CertificateRequest {
  id: string;
  collegeId: string;
  /** "NO_DUE" for requests of the original prototype; configured types use certificateTypeId. */
  certificateTypeKey: string;
  certificateTypeLabel: string;
  /** Configured type (colleges/{c}/certificateTypes/{id}) - absent on prototype NO_DUE requests. */
  certificateTypeId?: string;
  certificateTypeCode?: string;
  /** Snapshot of what the issuer needs at issue time (kept as it was when the student applied). */
  issuer?: RecipientResolver;
  templateId?: string;
  issuerFields?: CertificateFieldDef[];
  feeAmount?: number;
  /** The type's form fields as the student saw them, their answers, and the documents they attached. */
  fields?: CertificateFieldDef[];
  values?: Record<string, string>;
  attachments?: { key: string; label: string; url: string }[];
  /** RETURNED: which step sent it back, and what the student must correct. */
  returnedAtStep?: number;
  returnRemarks?: string;
  feeReceiptNo?: string;
  /** The issuer's entries at issue time (date of leaving, conduct ...). */
  issuerValues?: Record<string, string>;
  /** Number + verification code reserved by the first issue attempt (a retry reuses them - no gaps). */
  reservedNumber?: string;
  issuedCertificateId?: string;
  verificationCode?: string;

  requesterUid: string;
  requesterName: string;
  // Why the student needs this certificate - a controlled list (see
  // lib/certifications/purposes.ts); "purpose" is the resolved label, or
  // the student's own text when purposeCode is "OTHER". Optional on the
  // type only because requests submitted before this field existed have
  // neither - never omitted on a new submission.
  purposeCode?: string;
  purpose?: string;
  studentId: string;
  studentRollNumber: string;
  studentName: string;
  studentDepartment: string;
  studentYear: number;
  studentSection: string;

  status: CertificateRequestStatus;

  // Snapshot of getCertificateTypeDef("NO_DUE").flow at submission - later
  // changes to the code-level flow definition never affect a request already
  // in flight.
  flow: FlowStepDef[];
  currentStepIndex: number;
  // Grows lazily: steps[0..currentStepIndex] exist; a future step's
  // recipients are resolved fresh only when it actually becomes current.
  steps: StepRuntimeState[];

  // Denormalized "who can act right now" - the one generic inbox index.
  // Every role's inbox is the same query:
  //   where("pendingRecipientUids", "array-contains", myUid).where("status", "==", "IN_PROGRESS")
  pendingRecipientUids: string[];

  issuedByUid?: string;
  issuedByName?: string;
  issuedAt?: Timestamp | Date;
  certificateNumber?: string;
  certificateUrl?: string;

  // Decoupled from status/currentStepIndex - see ExamCellTask's own comment.
  examCellTask?: ExamCellTask;

  history: CertificateHistoryEntry[];

  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
  decidedAt?: Timestamp | Date;
}

/** One section's certificate-request counts, for an HOD's department-wide overview. */
export interface CertificateSectionOverviewRow {
  department: string;
  year: number;
  section: string;
  // IN_PROGRESS or PENDING_ISSUANCE - still moving through the flow.
  inProgress: number;
  // ISSUED.
  completed: number;
}
