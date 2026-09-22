import { ROLE_LEVEL } from "@/types/core";
import type { UserRole } from "@/types/core";

// Roles that are SEATS (positions a person is appointed to) rather than a
// person's own employment type. Everything else a login can be - teaching
// faculty (PANEL_MEMBER), supporting staff (COLLEGE_STAFF), College Office,
// College Admin - is a primary role.
export const SEAT_ROLES: UserRole[] = [
  "PRINCIPAL", "COLLEGE_ADMIN", "VICE_PRINCIPAL", "ACADEMICS", "HOD",
  "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "RND_COORDINATOR", "PLACEMENT_DEPT", "EXAM_CELL", "LIBRARY",
];

// What someone's primary role can be set to when they step out of a legacy
// role-account seat and carry on as an ordinary employee.
export const PRIMARY_ROLE_CHOICES: UserRole[] = ["PANEL_MEMBER", "COLLEGE_STAFF", "COLLEGE_OFFICE"];

export function isSeatRole(role: string): role is UserRole {
  return (SEAT_ROLES as string[]).includes(role);
}

// A college has exactly one Principal, one Vice Principal, and one College
// Admin; HOD is one seat per department; Academics is the only named position that
// can exist more than once.
export function isSingletonSeatRole(role: string): boolean {
  return role !== "ACADEMICS" && !seatNeedsDepartment(role);
}

// Does a users doc's STORED role make that account the very role a seat
// stands for (an old role-login)? College Admin has to be compared raw - it
// normalizes to PRINCIPAL everywhere else, which would make a College Admin
// account look like the Principal's.
export function roleMatchesSeat(storedRole: string, seatRole: string): boolean {
  if (storedRole === seatRole) return true;
  // A Department Office head is an HOD look-alike; a College Admin is NOT a
  // Principal's account, whatever they normalize to.
  return seatRole === "HOD" && storedRole === "DEPARTMENT_OFFICE";
}

// One seat per department: the HOD, and the R&D Coordinator who reviews that
// department's research submissions before they reach R&D.
export function seatNeedsDepartment(role: string): boolean {
  return role === "HOD" || role === "RND_COORDINATOR";
}

// The roles stored on a users doc can still be the un-normalized forms.
export function normalizeStoredRole(role: string): string {
  if (role === "COLLEGE_ADMIN") return "PRINCIPAL";
  if (role === "DEPARTMENT_OFFICE") return "HOD";
  return role;
}

// Who may put someone in a seat. College leadership - the College Admin, the
// Principal and the Vice Principal - all hold the same authority here, as do
// the tiers above (Super Admin, Management, the location's Administration).
// The Principal seat used to be reserved for the tiers above plus the College
// Admin; college leadership now appoints it too, so every seat answers to one
// list and there is no per-seat exception left.
//
// Judged on EVERY role this login can act as, not just its primary one. A seat
// is normally held by an ordinary person whose own account role stays
// PANEL_MEMBER - so a Principal-by-seat reads as `role: "PANEL_MEMBER"` with
// "PRINCIPAL" among `roles`. Matching on `role` alone showed them a Role
// Assignments page with no Change or Vacate on any seat, even though the
// server (requireRole -> resolveHeldRoles) had already accepted them as
// Principal. `roles` is exactly what api/auth/session sends the client
// (orderHeldRoles) and what requireRole puts on the session server-side, so
// both sides now answer identically.
export function canAssignSeat(actor: { role: string; realRole?: string; roles?: string[] }): boolean {
  const isCollegeAdmin = actor.realRole === "COLLEGE_ADMIN";
  const held = actor.roles && actor.roles.length > 0 ? actor.roles : [actor.role];
  const holds = (...allowed: string[]) =>
    held.some((r) => allowed.includes(normalizeStoredRole(r)));
  return (
    holds("SUPER_ADMIN", "MANAGEMENT", "ADMINISTRATION", "PRINCIPAL", "VICE_PRINCIPAL") ||
    isCollegeAdmin
  );
}

// Of the roles a person holds, the one a request should be evaluated as: the
// most senior (lowest ROLE_LEVEL number) among those the endpoint allows - so a
// faculty member who is also an HOD is treated as an HOD wherever the endpoint
// accepts both. On a tie the earlier entry wins, and `held` lists seat roles
// before the primary role.
export function pickEffectiveRole(held: string[], allowed: string[]): string | null {
  let best: string | null = null;
  let bestLevel = Infinity;
  for (const role of held) {
    if (!allowed.includes(role)) continue;
    const level = ROLE_LEVEL[role as UserRole] ?? 99;
    if (level < bestLevel) { best = role; bestLevel = level; }
  }
  return best;
}

// `held` ordering used everywhere: seat roles (most senior first), then the
// primary role, without duplicates.
export function orderHeldRoles(primary: string, seatRoles: string[]): string[] {
  const seats = Array.from(new Set(seatRoles.map(normalizeStoredRole)))
    .sort((a, b) => (ROLE_LEVEL[a as UserRole] ?? 99) - (ROLE_LEVEL[b as UserRole] ?? 99));
  return Array.from(new Set([...seats, normalizeStoredRole(primary)]));
}

// Seats that only teaching faculty can hold - the academic leadership line
// (department heads, academics heads, IQAC and R&D heads). Supporting staff and College
// Office never become an HOD. Every other seat (Principal, Vice Principal,
// T&P, Placement, Exam Cell, Library) can go to anyone. An old role account
// (whose own role IS a seat role) is always eligible: it's the seat's current
// or former holder, not a new appointment.
export const FACULTY_ONLY_SEAT_ROLES: UserRole[] = ["HOD", "ACADEMICS", "IQAC_COORDINATOR", "R_AND_D", "RND_COORDINATOR"];

export function canHoldSeat(personPrimaryRole: string, seatRole: string): boolean {
  if (!(FACULTY_ONLY_SEAT_ROLES as string[]).includes(seatRole)) return true;
  const primary = normalizeStoredRole(personPrimaryRole);
  return primary === "PANEL_MEMBER" || isSeatRole(primary);
}
