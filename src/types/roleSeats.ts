import type { Timestamp } from "firebase/firestore";
import type { UserRole } from "./core";

// ─── Role seats ────────────────────────────────────────────────────────────
// A "seat" is a position in the college - Principal, a department's HOD, Vice
// Principal, Academics, R&D head, ... - as opposed to the PERSON sitting in it. A
// person has one login (their personal college email) and a primary role
// (teaching faculty / supporting staff / office / administrator); any seats
// they hold add that seat's modules to the same dashboard. Everything an HOD
// did (approvals, department data) belongs to the seat, so when the holder
// changes nothing moves or is deleted - the new person simply sits in it.
//
// doc path: colleges/{collegeId}/roleSeats/{seatId}
// history:  colleges/{collegeId}/roleSeats/{seatId}/history/{entryId}
//
// A seat has AT MOST ONE holder at a time (an acting holder is covered by the
// Adjustments module, not by a second holder), but one person may hold several
// seats (HOD of two departments, or HOD + Academics of R&D).
export interface RoleSeat {
  id: string;
  collegeId: string;
  role: UserRole;
  // Human label shown in lists: "Head of Department - CSE", "Principal", ...
  label: string;
  // HOD / R&D Coordinator seats only - one seat per department.
  departmentId?: string;
  departmentName?: string;
  // The seat's own contact address (e.g. hod.cse@college.edu). It is an alias /
  // mailbox that stays with the seat as holders change - NOT a login. People
  // always sign in with their personal college email.
  roleEmail?: string;
  holderUid: string | null;
  holderName: string;
  holderSince?: Timestamp;
  // The id of the currently open history entry (the one with `to: null`).
  openHistoryId?: string;
  // Set when the seat was created from a pre-existing role-based login (an
  // account that used to BE the HOD / Principal). That account keeps working
  // until a real person takes the seat, at which point it's retired.
  legacyUid?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RoleSeatHistoryEntry {
  id: string;
  seatId: string;
  seatLabel: string;
  role: UserRole;
  uid: string;
  name: string;
  from: Timestamp;
  to: Timestamp | null;
  assignedBy: string;
  assignedByName: string;
  note?: string;
}

// What happens to the outgoing holder's own account when the seat is
// legacy-converted (their account WAS the role) - see assignSeat.
export type OutgoingHolderAction =
  | { action: "DEACTIVATE" }
  | { action: "SET_PRIMARY"; role: UserRole };
