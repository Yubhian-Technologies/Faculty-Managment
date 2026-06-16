import type { Timestamp } from "firebase/firestore";

// ─── Appraisal Cycle ──────────────────────────────────────────────────────────

export interface AppraisalCycle {
  id: string;
  collegeId: string;
  academicYear: string;                 // "2025-26"
  title: string;
  selfAppraisalDeadline: Timestamp;
  hodReviewDeadline: Timestamp;
  principalReviewDeadline?: Timestamp;
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Appraisal ────────────────────────────────────────────────────────────────

export type AppraisalStatus =
  | "PENDING"
  | "SELF_SUBMITTED"
  | "HOD_REVIEWED"
  | "PRINCIPAL_REVIEWED"
  | "FINALIZED";

export const APPRAISAL_STATUS_LABELS: Record<AppraisalStatus, string> = {
  PENDING: "Not Started",
  SELF_SUBMITTED: "Self Appraisal Done",
  HOD_REVIEWED: "HOD Reviewed",
  PRINCIPAL_REVIEWED: "Principal Reviewed",
  FINALIZED: "Finalized",
};

export type AppraisalRecommendation =
  | "PROMOTION"
  | "INCREMENT"
  | "MAINTAIN"
  | "IMPROVEMENT_NEEDED";

export const APPRAISAL_RECOMMENDATION_LABELS: Record<AppraisalRecommendation, string> = {
  PROMOTION: "Recommended for Promotion",
  INCREMENT: "Recommended for Increment",
  MAINTAIN: "Maintain Current Grade",
  IMPROVEMENT_NEEDED: "Improvement Required",
};

export interface Appraisal {
  id: string;
  collegeId: string;
  cycleId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  status: AppraisalStatus;
  selfAppraisal?: {
    teachingEffectiveness: number;          // 1–5
    researchActivity: number;              // 1–5
    administrationContribution: number;   // 1–5
    studentFeedbackScore: number;         // 1–5 (from student ratings)
    professionalDevelopment: number;      // 1–5
    achievements: string;
    challenges: string;
    goalsNextYear: string;
    submittedAt: Timestamp;
  };
  hodReview?: {
    teachingEffectiveness: number;
    researchActivity: number;
    administrationContribution: number;
    punctuality: number;
    teamwork: number;
    overallRating: number;
    remarks: string;
    reviewedBy: string;
    reviewedByName: string;
    reviewedAt: Timestamp;
  };
  principalReview?: {
    overallRating: number;
    remarks: string;
    recommendation: AppraisalRecommendation;
    reviewedBy: string;
    reviewedByName: string;
    reviewedAt: Timestamp;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
