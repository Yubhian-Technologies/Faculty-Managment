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
  | { kind: "STUDENT_DEPARTMENT_HOD" };

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

export type CertificateRequestStatus = "IN_PROGRESS" | "PENDING_ISSUANCE" | "ISSUED" | "REJECTED" | "CANCELLED";

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
  certificateTypeKey: "NO_DUE";
  certificateTypeLabel: string;

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
