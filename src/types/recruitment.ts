import type { Timestamp } from "firebase/firestore";
import type { WorkflowStatus } from "./core";

// ─── Vacancy Request ──────────────────────────────────────────────────────────

export type PositionCategory = "TEACHING" | "SUPPORTING_STAFF" | "GENERAL_ADMIN";

export interface VacancyRequest {
  id: string;
  collegeId: string;
  department: string;
  hodUid: string;
  hodName: string;
  position: string;
  positionCategory?: PositionCategory;
  qualification?: string;
  requiredCount: number;
  availableCount: number;
  justification?: string;
  status: WorkflowStatus;
  // Ratio-backed justification data (attached when HOD submits from the requirement panel)
  studentStrength?: number;
  totalFacultyRequired?: number;
  cadreRatioData?: Array<{
    key: string;
    label: string;
    required: number;
    current: number;
    gap: number;
    surplus: number;
  }>;
  hodAcknowledged?: boolean;      // HOD acknowledges after principal approval before collecting candidates
  principalResponse?: {
    action: WorkflowStatus;
    reason?: string;
    respondedAt: Timestamp;
    principalUid: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Candidate ────────────────────────────────────────────────────────────────

export type CandidateSource = "WALK_IN" | "CAREERS_PAGE" | "ADVERTISEMENT" | "REFERRAL";
export type ReferralType = "INTERNAL" | "EXTERNAL";

export type CandidateStage =
  | "DEMO"
  | "INTERVIEW"
  | "SALARY_NEGOTIATION"
  | "DOCUMENT_VERIFICATION"
  | "DECISION";

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  DEMO: "Demo Class",
  INTERVIEW: "Panel & HR Interview",
  SALARY_NEGOTIATION: "Salary Negotiation",
  DOCUMENT_VERIFICATION: "Document Verification",
  DECISION: "Final Decision",
};

// Sub-stages within INTERVIEW stage
export type InterviewSubStage =
  | "PANEL_IN_PROGRESS"
  | "HR_IN_PROGRESS"
  | "INTERVIEW_DONE";

export const INTERVIEW_SUB_STAGE_LABELS: Record<InterviewSubStage, string> = {
  PANEL_IN_PROGRESS: "Panel Interview",
  HR_IN_PROGRESS: "HR Interview",
  INTERVIEW_DONE: "Interview Complete",
};

export type CandidateStatus =
  | "PENDING"
  | "SHORTLISTED"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "APPROVED"
  | "REJECTED"
  | "WAITLISTED";

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  PENDING: "Pending",
  SHORTLISTED: "Shortlisted",
  ARRIVED: "Arrived",
  IN_PROGRESS: "In Progress",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WAITLISTED: "Waitlisted",
};

export type InterviewMode = "ONLINE" | "OFFLINE";

export interface Candidate {
  id: string;
  collegeId: string;
  batchId?: string;
  vacancyId?: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  position: string;
  resumeUrl: string;
  source: CandidateSource;
  currentStage: CandidateStage;
  interviewSubStage?: InterviewSubStage;
  status: CandidateStatus;
  isShortlisted: boolean;
  hasArrived: boolean;
  arrivedAt?: Timestamp;
  interviewMode?: InterviewMode;
  referralType?: ReferralType;
  referralName?: string;
  referralPhone?: string;
  referralDescription?: string;
  residenceAddress?: string;
  permanentAddress?: string;
  sameAddress?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Hiring Batch Phase ───────────────────────────────────────────────────────

export type BatchPhase =
  | "CANDIDATE_COLLECTION"    // HOD collecting & shortlisting candidates
  | "PANEL_SETUP"             // HOD setting panel members, date, batch submitted
  | "PRINCIPAL_REVIEW"        // Awaiting principal approval
  | "COLLEGE_OFFICE_SETUP"    // College office setting venue + required documents
  | "HOD_FINAL_SETUP"         // HOD assigning demo classroom + coordinator
  | "INTERVIEW_READY"         // All setup done, ready for interview day
  | "IN_PROGRESS"             // Demo day happening; coordinator runs QR session
  | "PANEL_INTERVIEW"         // HOD reviewed demo scores; panel members now scoring
  | "PRINCIPAL_FINAL_REVIEW"  // Principal reviews all feedback + decisions
  | "COMPLETED";              // Batch closed, offer/appointment letters issued

export const BATCH_PHASE_LABELS: Record<BatchPhase, string> = {
  CANDIDATE_COLLECTION: "Collecting Candidates",
  PANEL_SETUP: "Panel Setup",
  PRINCIPAL_REVIEW: "Principal Review",
  COLLEGE_OFFICE_SETUP: "Office Setup",
  HOD_FINAL_SETUP: "Final HOD Setup",
  INTERVIEW_READY: "Ready for Interview",
  IN_PROGRESS: "Demo In Progress",
  PANEL_INTERVIEW: "Panel Scoring",
  PRINCIPAL_FINAL_REVIEW: "Principal Final Review",
  COMPLETED: "Completed",
};

// ─── Hiring Batch ─────────────────────────────────────────────────────────────

export interface HiringBatch {
  id: string;
  collegeId: string;
  vacancyId: string;
  department: string;
  position: string;
  hodUid: string;
  panelMemberUids: string[];
  interviewDate: Timestamp;
  interviewTime?: string;
  interviewVenue?: string;
  demoClassroom?: string;
  meetingLink?: string;
  coordinatorFacultyId?: string;
  coordinatorUid?: string;
  coordinatorName?: string;
  candidateInfoCard?: string;     // visible to arriving candidates (venue, time, etc.)
  requiredDocuments?: string[];
  candidateIds: string[];
  status: WorkflowStatus;         // principal's approval decision
  currentPhase: BatchPhase;       // which step of the 9-phase workflow
  principalNotes?: string;
  setupComplete: boolean;
  demoComplete: boolean;
  interviewSubStage?: InterviewSubStage;
  principalFinalApproval?: {
    action: "APPROVED" | "REJECTED";
    remarks?: string;
    by: string;
    byName: string;
    at: Timestamp;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Panel Feedback (subcollection: hiringBatches/{batchId}/panelFeedback) ────

export interface PanelFeedback {
  id: string;
  collegeId: string;
  batchId: string;
  candidateId: string;
  panelUid: string;
  panelName: string;
  ratings: {
    technicalKnowledge: number;    // 1–5
    communicationSkills: number;   // 1–5
    teachingMethodology: number;   // 1–5
  };
  subjectsTested?: string[];
  strengths?: string;
  weaknesses?: string;
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  comments?: string;
  submittedAt: Timestamp;
}

// ─── Student Feedback (subcollection: hiringBatches/{batchId}/studentFeedback)

export interface StudentFeedback {
  id: string;
  collegeId: string;
  batchId: string;
  candidateId: string;
  ratings: {
    clarity: number;             // 1–5
    engagement: number;          // 1–5
    knowledgeDepth: number;      // 1–5
    timeManagement: number;      // 1–5
    overallImpression: number;   // 1–5
  };
  comments?: string;
  submittedAt: Timestamp;
}

// ─── HR Feedback (subcollection: hiringBatches/{batchId}/hrFeedback) ──────────

export interface HRFeedback {
  id: string;
  collegeId: string;
  batchId: string;
  candidateId: string;
  hrUid: string;
  hrName: string;
  ratings: {
    attitude: number;            // 1–5
    teamwork: number;            // 1–5
    adaptability: number;        // 1–5
    communication: number;       // 1–5
    overallFit: number;          // 1–5
  };
  salaryExpectation?: number;
  noticePeriod?: string;
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  comments?: string;
  submittedAt: Timestamp;
}

// ─── Hiring Salary Agreement (collection: hiringSalaryAgreements) ─────────────
// The salary negotiated at end of recruitment — distinct from monthly payroll

export interface HiringSalaryAgreement {
  id: string;
  collegeId: string;
  candidateId: string;
  batchId: string;
  candidateName: string;
  agreedMonthly: number;
  agreedAnnual: number;
  breakdown: {
    basic: number;
    hra: number;
    da: number;
    ta: number;
    medicalAllowance: number;
    otherAllowances: number;
    pf: number;
    professionalTax: number;
    tds: number;
  };
  negotiatedBy: string;
  negotiatedByUid: string;
  agreedAt: Timestamp;
  createdAt: Timestamp;
}

// ─── Hiring Document Verification (collection: hiringDocVerifications) ─────────

export interface HiringDocVerification {
  id: string;
  collegeId: string;
  candidateId: string;
  batchId: string;
  documents: Array<{
    name: string;
    required: boolean;
    verified: boolean;
    verifiedAt?: Timestamp;
    notes?: string;
  }>;
  verifiedBy: string;
  verifiedByUid: string;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Offer & Appointment Letters ──────────────────────────────────────────────

export interface OfferLetter {
  id: string;
  collegeId: string;
  candidateId: string;
  batchId: string;
  candidateName?: string;
  pdfUrl?: string;
  designation: string;
  department: string;
  joiningDate: Timestamp;
  ctcAnnual: number;
  subjects?: string[];
  generatedAt: Timestamp;
  status: "DRAFT" | "GENERATED" | "SENT" | "ACCEPTED" | "REJECTED";
  generatedBy: string;
  generatedByUid?: string;
}

export interface AppointmentLetter {
  id: string;
  collegeId: string;
  candidateId: string;
  batchId: string;
  facultyId?: string;           // set when faculty record is created post-hire
  pdfUrl?: string;
  designation: string;
  department: string;
  joiningDate: Timestamp;
  generatedAt: Timestamp;
  status: "DRAFT" | "GENERATED" | "SENT";
  generatedBy: string;
}
