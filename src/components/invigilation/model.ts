import { DESIGNATION_LABELS } from "@/types";
import type { DutyRef, DutySlot, InvigilationDuty, InvigilationRules, InvigilationSchedule } from "@/types/invigilation";
import type { Availability, Evaluation } from "@/lib/invigilation/eligibility";

// What the invigilation pages read from GET /api/college/invigilation/schedules/[id].

export interface SlotRow extends DutySlot { filled: number }
export interface FacultyRow { id: string; employeeId: string; name: string; department: string; designation: string; roles: string[]; duties: DutyRef[]; inactive?: boolean }
export interface Overview {
  schedule: InvigilationSchedule & { rules: InvigilationRules };
  slots: SlotRow[];
  sessions: string[];
  seatingPlans: { id: string; name: string; status: string }[];
  duties: InvigilationDuty[];
  faculty: FacultyRow[];
  canOverride: boolean;
}

export interface CandidateRow {
  facultyId: string; employeeId: string; name: string; department: string; designation: string; roles: string[];
  availability: Availability; evaluation: Evaluation; duties: DutyRef[];
  workload: { total: number; byCategory: Record<string, number>; onDate: number; completed: number; cancelled: number; reassigned: number };
  remaining: number | null;
  rooms: { room: string; date: string }[];
}

export const designationLabel = (d: string) => DESIGNATION_LABELS[d] ?? d.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export const AVAILABILITY_TONE: Record<Availability, "approved" | "pending" | "rejected" | "outline" | "secondary"> = {
  AVAILABLE: "approved",
  NEEDS_OVERRIDE: "pending",
  NO_TIMETABLE: "pending",
  PARTIAL: "secondary",
  BUSY: "rejected",
  ON_LEAVE: "rejected",
  ON_DUTY: "rejected",
  SUBJECT: "rejected",
  NOT_ELIGIBLE: "outline",
};

export const STATUS_TONE: Record<InvigilationDuty["status"], "approved" | "pending" | "rejected" | "outline" | "secondary"> = {
  DRAFT: "outline", PUBLISHED: "pending", ACKNOWLEDGED: "secondary", COMPLETED: "approved", CANCELLED: "rejected", REASSIGNED: "rejected",
};
