// ─── Exam rooms & seating plans ─────────────────────────────────────────────
// Classroom master data is kept by College Office; Exam Cell builds a named
// seating plan per exam from it (see lib/exams/seatingAllocator.ts).

// doc path: colleges/{collegeId}/examRooms/{id}
export interface ExamRoom {
  id: string;
  collegeId: string;
  name: string; // "201"
  block: string;
  floor: number;
  capacity: number;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SeatingStudent {
  id: string;
  rollNumber: string;
  name: string;
  sectionId: string;
  sectionLabel: string; // "CSE · 2nd Year · A"
}

export interface SeatingSectionRef {
  id: string;
  label: string;
  department: string;
  year: number;
  name: string;
  studentCount: number;
}

export interface SeatingRoomAllocation {
  roomId: string;
  name: string;
  block: string;
  floor: number;
  capacity: number;
  // Sections Exam Cell handpicked for this room. Empty/absent = any section
  // may fill it, in the order the sections were listed.
  allowedSectionIds?: string[];
  students: SeatingStudent[];
}

export type SeatingPlanStatus = "DRAFT" | "PUBLISHED";

// doc path: colleges/{collegeId}/examSeatingPlans/{id}
export interface ExamSeatingPlan {
  id: string;
  collegeId: string;
  name: string; // the exam's name, chosen by Exam Cell
  status: SeatingPlanStatus;
  sections: SeatingSectionRef[];
  rooms: SeatingRoomAllocation[];
  unplaced: SeatingStudent[];
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
