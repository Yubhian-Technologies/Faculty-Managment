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
const cache = new Map<string, { at: number; held: string[] }>();

interface SessionLike {
  uid: string;
  role: string;
  roles?: string[];
  collegeId?: string;
}

export async function resolveHeldRoles(session: SessionLike): Promise<string[]> {
  const fromCookie = session.roles?.length ? session.roles : [session.role];
  // Only college-scoped people can hold seats; GLOBAL/LOCATION roles keep their
  // own single role.
  if (!session.collegeId || ROLE_SCOPE[session.role as UserRole] !== "COLLEGE") return fromCookie;

  const key = `${session.collegeId}/${session.uid}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.held;

  try {
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    if (!snap.exists) return fromCookie;
    const u = snap.data() as { role?: string; seatRoles?: string[]; isActive?: boolean };
    // A deactivated account (e.g. a retired role login) loses access at once,
    // not when its cookie eventually expires.
    const held = u.isActive === false ? [] : orderHeldRoles(u.role ?? session.role, u.seatRoles ?? []);
    cache.set(key, { at: Date.now(), held });
    return held;
  } catch {
    return fromCookie;
  }
}

// Called right after a seat changes so the affected people don't wait out the
// cache window.
export function forgetHeldRoles(collegeId: string, uid: string): void {
  cache.delete(`${collegeId}/${uid}`);
}
