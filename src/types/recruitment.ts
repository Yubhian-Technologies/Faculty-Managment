import type { Timestamp } from "firebase/firestore";
import type { WorkflowStatus, UserRole } from "./core";

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
  // Free-text reasoning the HOD writes themselves, kept separate from the
  // generic ratio-backed `justification` above so neither overwrites the other.
  hodJustification?: string;
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
  religion?: string;
  caste?: string; // reservation category (OC/BC-*/SC/ST/EWS/Other)
  subCaste?: string; // free-text community / sub-caste within the category
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
  // Research/academic profile, for teaching-research faculty roles (paper
  // "Recommendations of the Recruiting Committee" form). Free text throughout,
  // matching the fill-in-the-blank paper form.
  researchProfile?: {
    firstAuthorPublications?: string;
    publicationsQ1OrHighIF?: string;
    reviewPublications?: string;
    totalPublicationsInclCoAuthor?: string;
    patentsPublished?: string;
    patentsGranted?: string;
    hIndex?: string;
    i10Index?: string;
    fundingReceived?: string;
    fundingApplied?: string;
    nationalExposure?: string;
    internationalExposure?: string;
    keyResearchSkills?: string;
  };
}

// Candidate is a pure person record — reusable across hiring requests over
// time. Everything specific to one hiring cycle (stage, documents, salary
// negotiation, committee recommendation, etc.) lives on CandidateApplication
// instead. A candidate may only have one active (non-REJECTED) application
// at a time, enforced server-side - once rejected from one, they can be
// attached to another.
export interface Candidate {
  id: string;
  collegeId: string;
  name: string;
  email: string;
  phone: string;
  resumeUrl: string;
  source: CandidateSource;
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
  addedByUid: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Candidate Application ─────────────────────────────────────────────────
// Join entity: "this Candidate applied to this Hiring Request (VacancyRequest)".
// A candidate may only have one active (non-REJECTED) application at a time,
// enforced server-side; a VacancyRequest/HiringBatch may have many
// applications. All per-hiring-cycle state lives here, not on Candidate.

export interface CandidateApplication {
  id: string;
  collegeId: string;
  candidateId: string;        // FK -> candidates/{id}
  vacancyRequestId: string;   // FK -> vacancyRequests/{id}
  batchId?: string;           // FK -> hiringBatches/{id}; "" until batched
  department: string;         // denormalized from VacancyRequest at attach time
  position: string;           // denormalized from VacancyRequest at attach time
  courseId?: string;              // course the candidate is being hired to teach (if teaching faculty)
  courseName?: string;
  year?: number;                  // academic year within the course
  preferredSubjectIds?: string[]; // subjects the candidate is expected to teach, if known at hiring time
  preferredSubjectNames?: string[];
  interviewMode?: InterviewMode;
  currentStage: CandidateStage;
  interviewSubStage?: InterviewSubStage;
  status: CandidateStatus;
  isShortlisted: boolean;
  hasArrived: boolean;
  arrivedAt?: Timestamp;
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
  // Recruiting committee's written recommendation (paper "Recommendations of
  // the Recruiting Committee" form), entered by the Principal before the final decision.
  committeeRecommendation?: string;
  addedByUid: string;
  addedByName: string;
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
  applicationIds: string[];
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
// One doc per (candidate, panelist), filled in across two modules of the same
// flow: demo-day scoring (while the batch is IN_PROGRESS) and panel-interview
// scoring (PANEL_INTERVIEW+). Either module's fields may be absent until that
// module is actually filled in by this panelist.

export type DemoRatingLevel = "EXCELLENT" | "GOOD" | "AVERAGE" | "POOR";

export interface PanelFeedback {
  id: string;
  collegeId: string;
  batchId: string;
  candidateId: string;
  panelUid: string;
  panelName: string;

  // Demo-day module (paper "Demo Sheet")
  demoRatings?: {
    planningAndOrganizing: DemoRatingLevel;
    effectiveUseOfTime: DemoRatingLevel;
    communicativeAbility: DemoRatingLevel;
    ensuringStudentAttention: DemoRatingLevel;
    chalkBoardWork: DemoRatingLevel;
    studentParticipation: DemoRatingLevel;
  };
  demoOverallScore?: number; // 1–10
  demoComments?: string;

  // Panel evaluation module — marks out of 10 per criterion. This is the active
  // evaluation form used across the HOD / panel / coordinator dashboards.
  panelScores?: {
    subjectKnowledge: number;    // 1–10
    presentationSkills: number;  // 1–10
    research: number;            // 1–10
    specificAttributes: number;  // 1–10
    others: number;              // 1–10
  };

  // Panel-interview module (paper "Panel Sheet")
  ratings?: {
    technicalKnowledge: number;    // 1–5
    communicationSkills: number;   // 1–5
    teachingMethodology: number;   // 1–5
  };
  remarksByCategory?: {
    subjectKnowledge?: string;
    communication?: string;
    presentationSkills?: string;
    research?: string;
    specificAttributes?: string;
    others?: string;
  };
  subjectsTested?: string[];
  strengths?: string;
  weaknesses?: string;
  recommendation?: "ACCEPT" | "REJECT" | "MAYBE";
  comments?: string;

  submittedAt: Timestamp;
  updatedAt?: Timestamp;
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

// ─── Hiring Terms & Conditions Library ─────────────────────────────────────────
// Principal-managed, reusable terms shown/ticked during offer negotiation
// (see /principal/settings and /principal/negotiate/[id]). Offers/applications
// store a text *snapshot* of whichever terms were selected, not a reference to
// this doc, so deactivating a template never changes what already-sent offers
// say.

export interface HiringTermsTemplate {
  id: string;
  collegeId: string;
  text: string;
  isActive: boolean;
  createdBy: string;
  createdByName: string;
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
  // Candidate self-service acceptance (see /offer-acceptance/[collegeId]/[offerId]).
  // offeredTerms is a snapshot of the terms shown to the candidate at send time -
  // not a reference to HiringTermsTemplate, so it never changes after the fact.
  offeredTerms?: string[];
  termsAcceptedAt?: Timestamp;
  candidateConfirmedJoiningDate?: string;
  respondedAt?: Timestamp;
  respondedBy?: "CANDIDATE" | string; // uid when a staff member used the manual override instead
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
  ctcAnnual?: number;          // finalized CTC carried over from the accepted offer letter
  candidateAddress?: string;
  termsAndConditions?: string; // full appointment-order clause text shown on the PDF, one clause per line
  generatedAt: Timestamp;
  status: "DRAFT" | "GENERATED" | "SENT";
  generatedBy: string;
  generatedByUid?: string;
}

// ─── Office → Webmaster Faculty Account Request ────────────────────────────────
// A distinct state machine from OfferLetter's own SENT/ACCEPTED/REJECTED -
// this tracks the separate "create this accepted candidate's login" handoff
// (see /college-office/offers "Request Faculty Account" and /webmaster).
// "Pending" from the spec is the pre-request eligibility gate shown in the UI
// before Office acts (offer ACCEPTED + appointment letter sent) - not a stored
// status; the doc is created directly at SUBMITTED.

export type FacultyAccountRequestStatus = "SUBMITTED" | "IN_PROGRESS" | "CREDENTIALS_CREATED" | "COMPLETED";

export const FACULTY_ACCOUNT_REQUEST_STATUS_LABELS: Record<FacultyAccountRequestStatus, string> = {
  SUBMITTED: "Submitted",
  IN_PROGRESS: "In Progress",
  CREDENTIALS_CREATED: "Credentials Created",
  COMPLETED: "Completed",
};

export interface FacultyAccountRequestAction {
  action: FacultyAccountRequestStatus;
  byUid: string;
  byName: string;
  byRole: UserRole;
  at: Timestamp;
  remarks?: string;
}

export interface FacultyAccountRequest {
  id: string;
  collegeId: string;
  offerId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  officialEmail: string; // "recommended" login email
  alternateEmail1?: string;
  alternateEmail2?: string;
  assignedEmail?: string; // whichever of officialEmail/alternateEmail1/alternateEmail2 was actually provisioned
  credentialResult?: { password?: string; revealed: boolean }; // one-time reveal payload for Office, see REVEAL_CREDENTIALS; password absent once revealed
  designation: string;
  department: string;
  // Employment type/specialization/qualification are no longer collected here -
  // the faculty profile goes to the Webmaster as-is and those details are set
  // directly on the facultyMembers record afterward (see facultyProvisioning.ts's
  // "PERMANENT"/"" defaults).
  status: FacultyAccountRequestStatus;
  history: FacultyAccountRequestAction[]; // doubles as this workflow's audit trail
  facultyId?: string;
  requestedBy: string;
  requestedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
