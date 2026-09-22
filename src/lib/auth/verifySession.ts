import { cookies } from "next/headers";
import { readSession } from "@/lib/auth/sessionToken";
import { canRoleAccessRole } from "@/types";
import type { UserRole } from "@/types";
import { resolveHeldRoles } from "@/lib/auth/liveRoles";
import { pickEffectiveRole } from "@/lib/roles/seatRoles";
import { ACTIVE_HOD_DEPT_COOKIE, decodeActiveHodDepartment } from "@/lib/roles/activeHodDepartment";

export interface SessionPayload {
  uid: string;
  email: string;
  role: string;
  // True underlying role, before the COLLEGE_ADMIN/DIRECTOR→PRINCIPAL
  // normalization api/auth/session applies to `role` everywhere - only ever
  // differs from `role` for a COLLEGE_ADMIN or DIRECTOR login. Absent on
  // cookies issued before this field existed; treat missing as "same as
  // role" (see isCollegeAdmin).
  realRole?: string;
  // Every role this login can act as at sign-in: `role` plus the role of each
  // seat held (see types/roleSeats.ts). A snapshot - guards re-check it live
  // (lib/auth/liveRoles.ts). Absent on cookies issued before seats existed.
  roles?: string[];
  collegeId: string;
  locationId: string;   // set for location-scoped roles; may also be set for college roles
  exp: number;
}

// A COLLEGE_ADMIN login's session always has `role === "PRINCIPAL"` (see
// api/auth/session's normalization) - this is the one place that still needs
// to tell them apart from a real Principal, e.g. to keep a feature Principal-
// only in the literal sense. Don't use this for permission checks in general;
// `role` remains the source of truth everywhere else on purpose.
export function isCollegeAdmin(session: Pick<SessionPayload, "realRole">): boolean {
  return session.realRole === "COLLEGE_ADMIN";
}

/**
 * A Department Office login, whose `role` always reads "HOD" (see
 * api/auth/session's normalization). They hold the same authority as their
 * department's HOD over everything operational, so this must NOT be used to
 * narrow ordinary permissions - `role` is still the right check for those.
 *
 * It exists for the one deliberate exception: appointing or removing leadership
 * stays with the actual HOD, so an office head can neither appoint another
 * office head nor remove a Sub-HOD. Otherwise whoever was appointed could
 * remove the person who appointed them.
 */
export function isDepartmentOffice(session: Pick<SessionPayload, "realRole">): boolean {
  return session.realRole === "DEPARTMENT_OFFICE";
}

export async function verifySession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("fms-session")?.value;
  if (!sessionCookie) return null;

  const payload = await readSession<SessionPayload>(sessionCookie);
  if (!payload) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

export async function requireSuperAdmin(): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session || session.role !== "SUPER_ADMIN") {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

// MANAGEMENT is a global, read-only role - routes using this must only implement GET handlers,
// with three deliberate exceptions: src/app/api/management/emergency-budget-requests/[id]/route.ts's
// PATCH (approve/reject/return an emergency budget request); src/app/api/management/leave-approvals/[id]/route.ts's
// PATCH (decide a Principal's own leave request, which has no one else within the college to
// approve it); and src/app/api/management/colleges/[collegeId]/principal-attendance/reset/route.ts's
// POST (reset a Principal's face registration - nobody within the college outranks a Principal to
// do it, mirroring HOD/Principal/VP resetting each other one tier down via
// /api/college/attendance/face-registration/reset); and the college role-seat routes
// (src/app/api/college/role-seats, via requireRole rather than this guard), where Management -
// like Super Admin and the location Administration - may appoint the college's Principal seat.
// Don't add more write routes under this role without the same justification.
export async function requireManagement(): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session || session.role !== "MANAGEMENT") {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

// Passes if the caller can act as ANY of `roles` - their primary role or the
// role of a seat they hold (Principal, a department's HOD, ...). The returned
// session's `role` is the one the request is evaluated as: the most senior
// held role the endpoint accepts, so a faculty member who is also an HOD is
// treated as an HOD wherever an endpoint lists both, exactly as a dedicated HOD
// login always was. Every existing `session.role === "HOD"` check therefore
// keeps working unchanged.
async function hasActiveHodPick(uid: string): Promise<boolean> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return decodeActiveHodDepartment(jar.get(ACTIVE_HOD_DEPT_COOKIE)?.value, uid) !== null;
  } catch {
    return false;
  }
}

export async function requireRole(...roles: string[]): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session) throw new Error("UNAUTHORIZED");
  const held = await resolveHeldRoles(session);
  let match = pickEffectiveRole(held, roles);
  if (!match) throw new Error("UNAUTHORIZED");
  // Someone who is both an HOD and a more senior seat holder (e.g. Vice
  // Principal) and has picked "HOD - <dept>" in the Working-as switcher must be
  // evaluated as that HOD - otherwise every endpoint accepting both roles
  // resolves to the senior one and returns the whole college, not the picked
  // department. The cookie is only set while working as an HOD and can only
  // move the caller to a role they actually hold, so it never widens access.
  if (match !== "HOD" && held.includes("HOD") && roles.includes("HOD") && (await hasActiveHodPick(session.uid))) {
    match = "HOD";
  }
  return match === session.role ? { ...session, roles: held } : { ...session, role: match, roles: held };
}

// Passes if the caller's role IS one of `targetRoles` OR inherits it via the
// L0–L6 level hierarchy (higher level, same-or-broader scope). Opt-in helper for
// routes that want inherited access - existing explicit guards are left untouched.
// Callers that read college/location-scoped data must still validate the tenant
// context (collegeId/locationId) themselves, since a higher role may carry none.
export async function requireRoleOrHigher(
  ...targetRoles: string[]
): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  const held = await resolveHeldRoles(session);
  const ok = held.some((actor) => targetRoles.some((t) => canRoleAccessRole(actor as UserRole, t as UserRole)));
  if (!ok) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

// Resolve the operative college for a route that may be called by BOTH
// college-scoped roles and the GLOBAL Finance/Purchase roles:
//   • college-scoped caller  → their own session.collegeId
//   • GLOBAL caller (FINANCE / PURCHASE_DEPT / SUPER_ADMIN, collegeId "") → the
//     `?collegeId=` query param set by the finance college-switcher.
// The body is never consumed (query param only), so routes can still read it.
// Drop-in replacement for requireCollegeMember on any finance-touching route.
export async function requireCollegeContext(
  request: Request,
  ...roles: string[]
): Promise<SessionPayload & { collegeId: string }> {
  const session = await requireRole(...roles);
  const collegeId =
    session.collegeId || (new URL(request.url).searchParams.get("collegeId") ?? "");
  if (!collegeId) {
    throw new Error("NO_COLLEGE_CONTEXT");
  }
  return { ...session, collegeId };
}

// For college-scoped roles (existing behavior - unchanged)
export async function requireCollegeMember(
  ...roles: string[]
): Promise<SessionPayload & { collegeId: string }> {
  const session = await requireRole(...roles);
  if (!session.collegeId) {
    throw new Error("NO_COLLEGE_CONTEXT");
  }
  return session as SessionPayload & { collegeId: string };
}

// For location-scoped roles (Administration, HR Admin, Admin Office, Dept Head)
export async function requireLocationMember(
  ...roles: string[]
): Promise<SessionPayload & { locationId: string }> {
  const session = await requireRole(...roles);
  if (!session.locationId) {
    throw new Error("NO_LOCATION_CONTEXT");
  }
  return session as SessionPayload & { locationId: string };
}

// Super Admin or location member (for shared APIs)
export async function requireLocationOrAdmin(
  ...roles: string[]
): Promise<SessionPayload> {
  const allRoles = ["SUPER_ADMIN", ...roles];
  return requireRole(...allRoles);
}
