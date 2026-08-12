import type { Timestamp } from "firebase/firestore";

// ─── Official Email Creation Request ───────────────────────────────────────
// Raised by College Office once a candidate has been finalized (offer
// accepted, faculty record ACTIVE) — a request for that college's own
// WEBMASTER (an internal, COLLEGE-scoped role, one per college, created by
// the Principal — see PRINCIPAL_ROLES in /api/college/users) to provision an
// official institutional email address. Distinct from FacultyMember.
// collegeEmail (the FMS login username, set earlier by the HOD when sending
// the offer letter): this is the real-world @college mailbox.
// Lives at colleges/{collegeId}/emailRequests/{id}.

export type EmailRequestStatus = "PENDING" | "COMPLETED" | "CANCELLED";

export const EMAIL_REQUEST_STATUS_LABELS: Record<EmailRequestStatus, string> = {
  PENDING: "Pending",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export interface EmailCreationRequest {
  id: string;
  collegeId: string;
  facultyId: string;
  candidateId?: string;

  // Snapshot of candidate/faculty info at request time, so the Webmaster's
  // queue can render full context without a second join.
  candidateName: string;
  designation: string;
  department: string;
  joiningDate: Timestamp;
  personalEmail?: string;
  phone?: string;

  preferredEmail1?: string;
  preferredEmail2?: string;

  status: EmailRequestStatus;

  requestedByUid: string;
  requestedByName: string;
  requestedAt: Timestamp;

  assignedEmail?: string;
  fulfilledByUid?: string;
  fulfilledByName?: string;
  fulfilledAt?: Timestamp;
  webmasterNotes?: string;

  cancelledReason?: string;

  updatedAt: Timestamp;
}
