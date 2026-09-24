import { getAdminDb } from "@/lib/firebase/admin";
import { orderHeldRoles } from "@/lib/roles/seatRoles";
import { ROLE_SCOPE } from "@/types/core";
import type { UserRole } from "@/types/core";

// The roles a login can act as RIGHT NOW: its primary role plus the role of
// every seat it holds (see types/roleSeats.ts). The session cookie carries a
// snapshot of these from sign-in, but a seat can be handed to someone else at
// any moment ("the previous holder loses the HOD modules as soon as the new
// person is assigned"), so guards re-read the person's own record - briefly
// cached, so a burst of requests costs one read, not one per request.
const TTL_MS = 20_000;
interface CacheEntry { at: number; held: string[]; realRole: string }
const cache = new Map<string, CacheEntry>();

interface SessionLike {
  uid: string;
  role: string;
  realRole?: string;
  roles?: string[];
  collegeId?: string;
  locationId?: string;
}

// Fetches (or returns the cached) live role info in one place, so
// resolveHeldRoles and resolveRealRole below never issue two separate reads
// for the same login within the cache window.
async function resolveLiveRoleInfo(session: SessionLike): Promise<CacheEntry> {
  const fromCookie = session.roles?.length ? session.roles : [session.role];
  const fallback: CacheEntry = { at: 0, held: fromCookie, realRole: session.realRole ?? session.role };
  const scope = ROLE_SCOPE[session.role as UserRole];

  if (scope === "COLLEGE") {
    // Only college-scoped people can hold seats.
    if (!session.collegeId) return fallback;

    const key = `${session.collegeId}/${session.uid}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;

    try {
      const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      if (!snap.exists) return fallback;
      const u = snap.data() as { role?: string; seatRoles?: string[]; isActive?: boolean };
      // A deactivated account (e.g. a retired role login) loses access at once,
      // not when its cookie eventually expires.
      const rawRole = u.role ?? session.role;
      const held = u.isActive === false ? [] : orderHeldRoles(rawRole, u.seatRoles ?? []);
      // Mirrors api/auth/session's realRole derivation: only COLLEGE_ADMIN and
      // DEPARTMENT_OFFICE ever diverge from the normalized `role`, and holding
      // the College Admin seat overrides even that - see SessionPayload.realRole.
      let realRole = rawRole === "COLLEGE_ADMIN" || rawRole === "DEPARTMENT_OFFICE" ? rawRole : session.role;
      if ((u.seatRoles ?? []).includes("COLLEGE_ADMIN")) realRole = "COLLEGE_ADMIN";
      const entry: CacheEntry = { at: Date.now(), held, realRole };
      cache.set(key, entry);
      return entry;
    } catch {
      return fallback;
    }
  }

  // GLOBAL/LOCATION-scoped roles don't hold seats, but still need the same
  // freshness guarantee: a Super Admin/Management deactivation or role change
  // (see admin/users/[uid] and location/users/[uid] PATCH) must take effect
  // within TTL_MS, not only once the 24h session cookie naturally expires.
  // GLOBAL profiles live in systemUsers/{uid}; LOCATION profiles live in
  // locations/{locationId}/locationUsers/{uid}. Neither scope has a
  // realRole/role divergence, so realRole just tracks the fresh role.
  const docRef = scope === "LOCATION" && session.locationId
    ? getAdminDb().collection("locations").doc(session.locationId).collection("locationUsers").doc(session.uid)
    : getAdminDb().collection("systemUsers").doc(session.uid);
  const key = `scoped:${scope}:${session.locationId ?? ""}:${session.uid}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  try {
    const snap = await docRef.get();
    if (!snap.exists) return fallback;
    const u = snap.data() as { role?: string; isActive?: boolean };
    const rawRole = u.role ?? session.role;
    const held = u.isActive === false ? [] : [rawRole];
    const entry: CacheEntry = { at: Date.now(), held, realRole: rawRole };
    cache.set(key, entry);
    return entry;
  } catch {
    return fallback;
  }
}

export async function resolveHeldRoles(session: SessionLike): Promise<string[]> {
  return (await resolveLiveRoleInfo(session)).held;
}

// Live counterpart to SessionPayload.realRole (see verifySession.ts's
// isCollegeAdmin/isDepartmentOffice) - re-derived from Firestore on the same
// short TTL as resolveHeldRoles, so a role change takes effect within the
// cache window instead of only once the session cookie naturally expires.
export async function resolveRealRole(session: SessionLike): Promise<string> {
  return (await resolveLiveRoleInfo(session)).realRole;
}

// Called right after a seat changes so the affected people don't wait out the
// cache window.
export function forgetHeldRoles(collegeId: string, uid: string): void {
  cache.delete(`${collegeId}/${uid}`);
}
