import { ROLE_LEVEL } from "@/types/core";
import type { UserRole } from "@/types/core";
import { ROUTABLE_REQUESTER_ROLES } from "./approvalRouting";

// Which requester roles get the "vacation" leave entitlement (CL/SL/SCL/EL-6/OD
// + summer vacation) and which the "non-vacation" one (CL/SL/EL-30/OD).
// Settings > "Vacation / Non-Vacation Staff" stores one true/false per role
// (FacultyNorms.leaveVacationRoles); a role with no entry uses the default
// below, which is exactly what each role got before this was configurable.
export type LeaveVacationRoles = Partial<Record<UserRole, boolean>>;

const LEADERSHIP_VACATION_ROLES: UserRole[] = ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS"];

// Faculty depend on their own record: any FacultyMember is vacation staff
// except a not-yet-migrated legacy technical designation (see identity.ts).
export function defaultIsVacation(role: UserRole, identityIsTeaching: boolean): boolean {
  if (role === "PANEL_MEMBER") return identityIsTeaching;
  return LEADERSHIP_VACATION_ROLES.includes(role);
}

// Judged on the HIGHEST seat the person holds - the same rule leave approval
// routing uses - so a faculty member who is also an HOD follows the HOD
// setting. Seats that aren't requester roles (R&D Coordinator) are ignored.
// Two seats at the same level: vacation wins, so the tie never depends on
// list order.
export function resolveIsVacation(
  config: LeaveVacationRoles | undefined,
  heldRoles: readonly string[],
  identityIsTeaching: boolean
): boolean {
  const routable = heldRoles.filter((r) => ROUTABLE_REQUESTER_ROLES.includes(r as UserRole)) as UserRole[];
  if (routable.length === 0) return identityIsTeaching;
  const topLevel = Math.min(...routable.map((r) => ROLE_LEVEL[r] ?? 99));
  return routable
    .filter((r) => (ROLE_LEVEL[r] ?? 99) === topLevel)
    .some((r) => config?.[r] ?? defaultIsVacation(r, identityIsTeaching));
}

export function sanitizeLeaveVacationRoles(input: unknown): { ok: true; value: LeaveVacationRoles } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "leaveVacationRoles must be an object" };
  const value: LeaveVacationRoles = {};
  for (const [role, flag] of Object.entries(input as Record<string, unknown>)) {
    if (!ROUTABLE_REQUESTER_ROLES.includes(role as UserRole)) return { ok: false, error: `${role} can't be set as vacation / non-vacation` };
    if (typeof flag !== "boolean") return { ok: false, error: `Invalid value for ${role}` };
    value[role as UserRole] = flag;
  }
  return { ok: true, value };
}
