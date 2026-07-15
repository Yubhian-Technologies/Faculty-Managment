import { cookies } from "next/headers";
import { canRoleAccessRole } from "@/types";
import type { UserRole } from "@/types";

export interface SessionPayload {
  uid: string;
  email: string;
  role: string;
  collegeId: string;
  locationId: string;   // set for location-scoped roles; may also be set for college roles
  exp: number;
}

export async function verifySession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("fms-session")?.value;
  if (!sessionCookie) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(sessionCookie.split(".")[1], "base64").toString()
    ) as SessionPayload;

    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireSuperAdmin(): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session || session.role !== "SUPER_ADMIN") {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

// MANAGEMENT is a global, read-only role — routes using this must only implement GET handlers,
// with one deliberate exception: src/app/api/management/emergency-budget-requests/[id]/route.ts's
// PATCH, which lets Management approve/reject/return emergency budget requests. Don't add more
// write routes under this role without the same justification.
export async function requireManagement(): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session || session.role !== "MANAGEMENT") {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireRole(...roles: string[]): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session || !roles.includes(session.role)) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

// Passes if the caller's role IS one of `targetRoles` OR inherits it via the
// L0–L6 level hierarchy (higher level, same-or-broader scope). Opt-in helper for
// routes that want inherited access — existing explicit guards are left untouched.
// Callers that read college/location-scoped data must still validate the tenant
// context (collegeId/locationId) themselves, since a higher role may carry none.
export async function requireRoleOrHigher(
  ...targetRoles: string[]
): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  const actor = session.role as UserRole;
  const ok = targetRoles.some((t) => canRoleAccessRole(actor, t as UserRole));
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

// For college-scoped roles (existing behavior — unchanged)
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
