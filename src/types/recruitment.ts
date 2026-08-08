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
export type ReferralInfluenceType = "NONE" | "MLA" | "MP" | "OTHER";

export type CandidateStage =
  | "DEMO"
  | "INTERVIEW"
  | "SALARY_NEGOTIATION"
  | "DECISION";

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  DEMO: "Demo Class",
  INTERVIEW: "Panel Interview",
  SALARY_NEGOTIATION: "Salary Negotiation",
  DECISION: "Final Decision",
};

// Sub-stages within INTERVIEW stage
export type InterviewSubStage =
  | "PANEL_IN_PROGRESS"
  | "INTERVIEW_DONE";

export const INTERVIEW_SUB_STAGE_LABELS: Record<InterviewSubStage, string> = {
  PANEL_IN_PROGRESS: "Panel Interview",
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

// Self-reported by the candidate via the public /candidate-form link sent with
// the interview call letter. Field names match FacultyMember/PersonalDetailsFields
// (src/types/core.ts) where they overlap, so this could later prefill
// hod/faculty/[id]/edit post-hire (not wired up yet).
export interface AcademicQualification {
  id: string;
  degree: string;
  institution: string;
  yearOfPassing: string;
  percentageOrCGPA: string;
  certificateUrl?: string;
  certificateName?: string;
}

export interface WorkExperienceEntry {
  id: string;
  organization: string;
  designation: string;
  fromDate: string; // yyyy-mm
  toDate: string;   // yyyy-mm, or "Present"
  responsibilities?: string;
}

export interface RelativeInSociety {
  id: string;
  name: string;
  relationship: string;
  workingLocation: string;
  profession: string;
  experience: string;
}

export interface CandidateBioData {
  fatherName?: string;
  motherName?: string;
  dateOfBirth?: string;   // yyyy-mm-dd string from <input type="date">, not a Timestamp
  gender?: string;
  maritalStatus?: "Single" | "Married";
  spouseName?: string;
  aadharNo?: string;
  panNo?: string;
  bloodGroup?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  // Hiring-specific, self-reported — not on FacultyMember
  currentEmployer?: string;
  totalExperienceYears?: string;
  currentCTC?: string;
  expectedCTC?: string;
  noticePeriod?: string;
  references?: string;
  additionalInfo?: string;
  qualifications?: AcademicQualification[];
  experiences?: WorkExperienceEntry[];
  hasRelativesInSociety?: boolean;
  relatives?: RelativeInSociety[];
}

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
  courseId?: string;              // course the candidate is being hired to teach (if teaching faculty)
  courseName?: string;
  year?: number;                  // academic year within the course
  preferredSubjectIds?: string[]; // subjects the candidate is expected to teach, if known at hiring time
  preferredSubjectNames?: string[];
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
  referralCollege?: string;         // internal referral: college the referrer works at
  referralDesignation?: string;     // internal referral: referrer's designation
  referralInfluenceType?: ReferralInfluenceType; // external referral: MLA/MP/other influential person
  referralInfluenceOther?: string;
  residenceAddress?: string;
  permanentAddress?: string;
  sameAddress?: boolean;
  bioData?: CandidateBioData;
  certificates?: Array<{ name: string; url: string }>;
  bioDataSubmitted?: boolean;
  bioDataSubmittedAt?: Timestamp;
  documentVerification?: {
    checkedDocs: Record<string, boolean>; // document label -> verified
    verifiedBy: string;
    verifiedByName: string;
    verifiedAt: Timestamp;
    allVerified?: boolean; // server-computed: every HiringBatch.requiredDocuments entry checked
    notifiedPrincipalAt?: Timestamp; // office told the Principal docs are ready for the appointment letter
  };
  // Office-uploaded scan of the manually-signed joining letter (post document verification).
  joiningLetterUrl?: string;
  joiningLetterUploadedAt?: Timestamp;
  joiningLetterUploadedByName?: string;
  // Captured by the Principal at final-decision time (see principal/decisions/[id]).
  // negotiatedSalary/dateOfJoining flow automatically into the generated OfferLetter;
  // expectedSalary is retained only for internal reference/comparison.
  expectedSalary?: number;
  negotiatedSalary?: number;
  dateOfJoining?: string; // yyyy-mm-dd
  // Terms the Principal ticked at decision time; flows into the offer letter's
  // Terms & Conditions field as a starting point for the office (still editable there).
  termsAndConditions?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Hiring Batch Phase ───────────────────────────────────────────────────────

// A batch is created directly at PRINCIPAL_REVIEW (the HOD has already
// collected candidates and set up the panel before submitting) and only
// moves forward from there — there is no pre-batch "collection"/"setup"
// phase in the data model.
export type BatchPhase =
  | "PRINCIPAL_REVIEW"        // Awaiting principal approval
  | "HOD_FINAL_SETUP"         // HOD assigning demo classroom + coordinator
  | "INTERVIEW_READY"         // All setup done, ready for interview day
  | "IN_PROGRESS"             // Demo day happening; coordinator runs QR session
  | "PANEL_INTERVIEW"         // HOD reviewed demo scores; panel members now scoring
  | "PRINCIPAL_FINAL_REVIEW"  // Principal reviews all feedback + decisions
  | "COMPLETED";              // Batch closed, offer/appointment letters issued

export const BATCH_PHASE_LABELS: Record<BatchPhase, string> = {
  PRINCIPAL_REVIEW: "Principal Review",
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
  hodName?: string;
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
  termsAndConditions?: string;
  generatedAt: Timestamp;
  status: "DRAFT" | "GENERATED" | "SENT" | "ACCEPTED" | "REJECTED";
  generatedBy: string;
  generatedByUid?: string;
  ccEmails?: string[]; // Principal/VP/panel/HOD/Accounts - resolved once at send time
  // Office → Webmaster credential handoff (see /college-office/offers and /webmaster).
  credentialsRequestedAt?: Timestamp;
  credentialsRequestedBy?: string;
  credentialsRequestedByName?: string;
  credentialsFulfilledAt?: Timestamp;
  credentialsFulfilledBy?: string;
}

export interface AppointmentLetter {
  id: string;
  collegeId: string;
  candidateId: string;
  candidateName?: string;
  batchId: string;
  facultyId?: string;           // set when faculty record is created post-hire
  pdfUrl?: string;
  designation: string;
  department: string;
  joiningDate: Timestamp;
  generatedAt: Timestamp;
  status: "DRAFT" | "GENERATED" | "SENT";
  generatedBy: string;
  generatedByUid?: string;
}
