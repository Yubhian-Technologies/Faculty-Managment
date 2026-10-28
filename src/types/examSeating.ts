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
  // Benches and students per bench (1-3). `capacity` = benches x studentsPerBench,
  // kept stored for older readers. Rooms added before benches existed carry
  // only `capacity` - see lib/exams/roomLayout.ts for the fallbacks.
  benches?: number;
  studentsPerBench?: number;
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
  // Layered plans only: which seat on the bench (1..studentsPerBench). All
  // students of one layer in a room belong to one branch.
  layer?: number;
  // Paired plans: the bench number in the room (1..benches), and the group the
  // student was seated with (branch + year of the Mid timetable) - two students
  // of one group never share a bench.
  bench?: number;
  group?: string;
}

/** Paired plans: the groups (branch + year writing on that date) seated in each seat position, in order. */
export interface SeatingStream {
  seat: number; // 1 = seat A ...
  groups: { key: string; label: string; count: number }[];
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
  benches?: number;
  perBench?: number;
  // Sections Exam Cell handpicked for this room. Empty/absent = any section
  // may fill it, in the order the sections were listed.
  allowedSectionIds?: string[];
  students: SeatingStudent[];
}

// QUICK: one-shot auto-fill, one student per bench. LAYERED: sections are
// allotted one at a time, each into a bench layer of the rooms chosen for it.
// PAIRED: from a Mid timetable date - each seat position of a bench takes its
// own stream of groups (e.g. seat A: CSE, seat B: Civil then Mech), bench by
// bench, room by room in the order picked.
export type SeatingPlanMode = "QUICK" | "LAYERED" | "PAIRED";

export type SeatingPlanStatus = "DRAFT" | "PUBLISHED";

// doc path: colleges/{collegeId}/examSeatingPlans/{id}
export interface ExamSeatingPlan {
  id: string;
  collegeId: string;
  name: string; // the exam's name, chosen by Exam Cell
  status: SeatingPlanStatus;
  mode?: SeatingPlanMode;
  sections: SeatingSectionRef[];
  rooms: SeatingRoomAllocation[];
  unplaced: SeatingStudent[];
  // PAIRED plans: the Mid timetables seated (one arrangement for every exam day
  // of the Mid), their exam days, the exam time, and the seat streams.
  midPlanIds?: string[];
  examDays?: string[];
  examDate?: string; // older drafts: one date
  examTime?: string;
  streams?: SeatingStream[];
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
