import type { Timestamp } from "firebase/firestore";

// ─── Grievance ────────────────────────────────────────────────────────────────

export type GrievanceCategory =
  | "SALARY"
  | "WORKLOAD"
  | "INFRASTRUCTURE"
  | "HARASSMENT"
  | "ADMINISTRATIVE"
  | "LEAVE"
  | "CAREER_PROGRESSION"
  | "OTHER";

export const GRIEVANCE_CATEGORY_LABELS: Record<GrievanceCategory, string> = {
  SALARY: "Salary & Compensation",
  WORKLOAD: "Work Load",
  INFRASTRUCTURE: "Infrastructure",
  HARASSMENT: "Harassment",
  ADMINISTRATIVE: "Administrative Issues",
  LEAVE: "Leave Related",
  CAREER_PROGRESSION: "Career Progression",
  OTHER: "Other",
};

export type GrievanceStatus =
  | "OPEN"
  | "UNDER_REVIEW"
  | "ESCALATED_TO_PRINCIPAL"
  | "RESOLVED"
  | "CLOSED";

export const GRIEVANCE_STATUS_LABELS: Record<GrievanceStatus, string> = {
  OPEN: "Open",
  UNDER_REVIEW: "Under Review",
  ESCALATED_TO_PRINCIPAL: "Escalated to Principal",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export interface GrievanceTimeline {
  action: string;
  by: string;
  byName: string;
  at: Timestamp;
  note?: string;
}

export interface Grievance {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  category: GrievanceCategory;
  subject: string;
  description: string;
  isAnonymous: boolean;
  status: GrievanceStatus;
  assignedTo?: string;
  assignedToName?: string;
  resolution?: {
    description: string;
    resolvedBy: string;
    resolvedByName: string;
    resolvedAt: Timestamp;
  };
  timeline: GrievanceTimeline[];
  attachmentUrls?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
