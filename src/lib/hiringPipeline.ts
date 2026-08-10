import type { VacancyRequest, HiringBatch, CandidateStatus, CandidateStage, BatchPhase, FacultyAccountRequestStatus } from "@/types";
import type { StepState } from "@/components/shared/PipelineStep";

export type PipelineStage = 1 | 2 | 3 | 4;

// Which of the 4 stages (Request / Candidates / Interview / Hiring Results) a
// vacancy is currently at - shared by HOD's pipeline board and Principal's
// hiring requests view so both sides render the exact same stepper.
export function getCurrentStage(vacancy: VacancyRequest, batch: HiringBatch | null): PipelineStage {
  if (vacancy.status !== "APPROVED") return 1;
  if (!batch) return 2;
  if (batch.currentPhase === "COMPLETED" || batch.currentPhase === "PRINCIPAL_FINAL_REVIEW") return 4;
  return 3;
}

export function stateForStage(stage: PipelineStage, currentStage: PipelineStage): StepState {
  if (stage < currentStage) return "done";
  if (stage === currentStage) return "current";
  return "upcoming";
}

// ─── Detailed post-decision hiring status ──────────────────────────────────────
// A finer-grained status than the 4-stage stepper above, covering everything
// from the interview decision through faculty account creation. Computed
// purely from existing fields (CandidateApplication/OfferLetter/AppointmentLetter/
// FacultyAccountRequest) - no schema changes. SELECTED and FACULTY_ONBOARDED are
// kept in the label map for completeness with the spec's requested vocabulary,
// but nothing in the current data model distinguishes them from OFFER_PENDING /
// APPOINTMENT_LETTER_SENT respectively, so the compute function below never
// actually returns them.
export type DetailedHiringStatus =
  | "INTERVIEW_COMPLETED"
  | "SELECTED"
  | "OFFER_PENDING"
  | "OFFER_SENT"
  | "CANDIDATE_ACCEPTANCE_PENDING"
  | "OFFER_ACCEPTED"
  | "DOCUMENTS_VERIFICATION"
  | "JOINING_LETTER_UPLOADED"
  | "APPOINTMENT_LETTER_PENDING"
  | "APPOINTMENT_LETTER_SENT"
  | "FACULTY_ONBOARDED"
  | "ACCOUNT_CREATION_PENDING"
  | "CREDENTIALS_CREATED"
  | "HIRING_COMPLETED";

export const DETAILED_HIRING_STATUS_LABELS: Record<DetailedHiringStatus, string> = {
  INTERVIEW_COMPLETED: "Interview Completed",
  SELECTED: "Selected",
  OFFER_PENDING: "Offer Pending",
  OFFER_SENT: "Offer Sent",
  CANDIDATE_ACCEPTANCE_PENDING: "Candidate Acceptance Pending",
  OFFER_ACCEPTED: "Offer Accepted",
  DOCUMENTS_VERIFICATION: "Documents Verification",
  JOINING_LETTER_UPLOADED: "Joining Letter Uploaded",
  APPOINTMENT_LETTER_PENDING: "Appointment Letter Pending",
  APPOINTMENT_LETTER_SENT: "Appointment Letter Sent",
  FACULTY_ONBOARDED: "Faculty Onboarded",
  ACCOUNT_CREATION_PENDING: "Account Creation Pending",
  CREDENTIALS_CREATED: "Credentials Created",
  HIRING_COMPLETED: "Hiring Completed",
};

export function getDetailedHiringStatus(input: {
  applicationStatus: CandidateStatus;
  currentStage: CandidateStage;
  batchPhase?: BatchPhase;
  notifiedPrincipalDocsReady?: boolean;
  joiningLetterUrl?: string;
  offerStatus?: "SENT" | "ACCEPTED" | "REJECTED";
  appointmentLetterExists?: boolean;
  accountRequestStatus?: FacultyAccountRequestStatus;
}): DetailedHiringStatus | null {
  const {
    applicationStatus,
    currentStage,
    batchPhase,
    notifiedPrincipalDocsReady,
    joiningLetterUrl,
    offerStatus,
    appointmentLetterExists,
    accountRequestStatus,
  } = input;

  if (accountRequestStatus === "COMPLETED") return "HIRING_COMPLETED";
  if (accountRequestStatus === "CREDENTIALS_CREATED") return "CREDENTIALS_CREATED";
  if (accountRequestStatus === "SUBMITTED" || accountRequestStatus === "IN_PROGRESS") return "ACCOUNT_CREATION_PENDING";
  if (appointmentLetterExists) return "APPOINTMENT_LETTER_SENT";
  if (notifiedPrincipalDocsReady) return "APPOINTMENT_LETTER_PENDING";
  if (joiningLetterUrl) return "JOINING_LETTER_UPLOADED";
  if (offerStatus === "ACCEPTED") return "DOCUMENTS_VERIFICATION";
  if (offerStatus === "SENT") return "CANDIDATE_ACCEPTANCE_PENDING";
  if (applicationStatus === "APPROVED" && currentStage === "DECISION") return "OFFER_PENDING";
  if (batchPhase === "PANEL_INTERVIEW" || batchPhase === "PRINCIPAL_FINAL_REVIEW" || batchPhase === "COMPLETED") return "INTERVIEW_COMPLETED";
  return null;
}
