import type { VacancyRequest, HiringBatch, CandidateStatus, CandidateStage, BatchPhase, FacultyAccountRequestStatus } from "@/types";
import type { StepState } from "@/components/shared/PipelineStep";

export type PipelineStage = 1 | 2 | 3 | 4 | 5;

// Which of the 5 stages (Request / Candidates / Interview / Decision /
// Onboarding) a vacancy is currently at - shared by HOD's pipeline board and
// Principal's hiring requests view so both sides render the exact same
// stepper, all the way through to faculty account creation instead of
// stopping at the interview decision.
export function getCurrentStage(vacancy: VacancyRequest, batch: HiringBatch | null): PipelineStage {
  if (vacancy.status !== "APPROVED") return 1;
  if (!batch) return 2;
  if (batch.currentPhase === "COMPLETED") return 5;
  if (batch.currentPhase === "PRINCIPAL_FINAL_REVIEW") return 4;
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

// Minimal per-candidate shape getApprovedDetailedStatuses needs - both HOD's
// and Principal's pipeline boards' joined application+candidate views satisfy
// this already.
export interface HiringDecisionCandidate {
  candidateId: string;
  status: CandidateStatus;
  currentStage: CandidateStage;
  notifiedPrincipalDocsReady?: boolean;
  joiningLetterUrl?: string;
}

// Computes the detailed 14-stage status for every candidate a Principal has
// approved (the ones whose journey continues past the interview decision),
// for feeding into getOnboardingSummary. Shared by HOD's and Principal's
// pipeline boards so neither has its own bespoke copy of this join.
export function getApprovedDetailedStatuses(
  candidates: HiringDecisionCandidate[],
  batchPhase: BatchPhase | undefined,
  offerStatusByCandidate: Record<string, "SENT" | "ACCEPTED" | "REJECTED">,
  appointmentCandidateIds: Set<string>,
  accountRequestStatusByCandidate: Record<string, FacultyAccountRequestStatus>
): (DetailedHiringStatus | null)[] {
  return candidates
    .filter((c) => c.status === "APPROVED" && c.currentStage === "DECISION")
    .map((c) =>
      getDetailedHiringStatus({
        applicationStatus: c.status,
        currentStage: c.currentStage,
        batchPhase,
        notifiedPrincipalDocsReady: c.notifiedPrincipalDocsReady,
        joiningLetterUrl: c.joiningLetterUrl,
        offerStatus: offerStatusByCandidate[c.candidateId],
        appointmentLetterExists: appointmentCandidateIds.has(c.candidateId),
        accountRequestStatus: accountRequestStatusByCandidate[c.candidateId],
      })
    );
}

// A vacancy/candidate only counts as fully closed once the faculty account's
// credentials have actually been created - not merely once the batch reached
// COMPLETED (which happens right after the Principal's decision, long before
// offer/docs/appointment/credentials) or once an appointment letter exists.
// Shared by the HOD, Principal, and Accounts pipeline boards, and (in its
// single-candidate form) by the College Office documents page, so "closed"
// means the same thing everywhere instead of each view guessing its own proxy.
export function isHiringClosed(
  vacancyStatus: VacancyRequest["status"],
  batchPhase: BatchPhase | undefined,
  approvedCandidateIds: string[],
  accountRequestStatusByCandidate: Record<string, FacultyAccountRequestStatus>
): boolean {
  if (vacancyStatus === "REJECTED") return true;
  if (batchPhase !== "COMPLETED") return false;
  if (approvedCandidateIds.length === 0) return true;
  return approvedCandidateIds.every((id) => {
    const s = accountRequestStatusByCandidate[id];
    return s === "CREDENTIALS_CREATED" || s === "COMPLETED";
  });
}

const DETAILED_STATUS_ORDER = Object.keys(DETAILED_HIRING_STATUS_LABELS) as DetailedHiringStatus[];

// Summarizes a batch's approved candidates' post-decision progress as the
// stage 5 "Onboarding" step's sub-label - the least-advanced status among
// them, since that's the one still needing attention. Shared by HOD's and
// Principal's pipeline boards so the "cut at Hiring Results" doesn't recur:
// this is the single place the full 14-stage journey gets rolled up.
export function getOnboardingSummary(statuses: (DetailedHiringStatus | null)[]): string {
  if (statuses.length === 0) return "No candidates approved yet";
  const known = statuses.filter((s): s is DetailedHiringStatus => s !== null);
  if (known.length === 0) return "Awaiting offer letter";
  const counts = DETAILED_STATUS_ORDER.map((status) => known.filter((s) => s === status).length);
  const leastAdvancedIdx = counts.findIndex((n) => n > 0);
  const status = DETAILED_STATUS_ORDER[leastAdvancedIdx];
  const label = DETAILED_HIRING_STATUS_LABELS[status];
  return statuses.length > 1 ? `${label} (${counts[leastAdvancedIdx]}/${statuses.length})` : label;
}
