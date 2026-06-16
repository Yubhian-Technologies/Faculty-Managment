import type { Timestamp } from "firebase/firestore";

// ─── Training Program ─────────────────────────────────────────────────────────

export type TrainingCategory =
  | "FDP"
  | "WORKSHOP"
  | "SEMINAR"
  | "CONFERENCE"
  | "CERTIFICATION"
  | "ONLINE_COURSE"
  | "INDUCTION";

export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, string> = {
  FDP: "Faculty Development Programme",
  WORKSHOP: "Workshop",
  SEMINAR: "Seminar",
  CONFERENCE: "Conference",
  CERTIFICATION: "Certification Course",
  ONLINE_COURSE: "Online Course",
  INDUCTION: "Induction Programme",
};

export type TrainingStatus = "UPCOMING" | "ONGOING" | "COMPLETED" | "CANCELLED";

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  UPCOMING: "Upcoming",
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export interface TrainingProgram {
  id: string;
  collegeId: string;
  title: string;
  category: TrainingCategory;
  organizer: string;
  venue?: string;
  isExternal: boolean;              // internal college programme vs external
  fromDate: Timestamp;
  toDate: Timestamp;
  totalHours: number;
  maxParticipants?: number;
  description?: string;
  registrationDeadline?: Timestamp;
  status: TrainingStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Training Enrollment ──────────────────────────────────────────────────────

export type EnrollmentStatus = "ENROLLED" | "COMPLETED" | "DROPPED" | "WAITLISTED";

export interface TrainingEnrollment {
  id: string;
  collegeId: string;
  trainingId: string;
  trainingTitle: string;
  category: TrainingCategory;
  facultyId: string;
  facultyName: string;
  department: string;
  status: EnrollmentStatus;
  certificateUrl?: string;
  completedHours?: number;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
