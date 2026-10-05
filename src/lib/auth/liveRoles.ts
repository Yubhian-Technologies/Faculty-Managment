import { getAdminDb } from "@/lib/firebase/admin";
import { orderHeldRoles } from "@/lib/roles/seatRoles";
import { activeDelegatedRoles } from "@/lib/leave/roleDelegation";
import { ROLE_SCOPE } from "@/types/core";
import type { UserRole } from "@/types/core";
import {
  isAllowedReadOnlyRequest, isFacultyCapableRole, isReadMethod, isReadOnlyFacultyCollege, METHOD_HEADER, PATH_HEADER,
} from "@/lib/auth/readOnlyAccess";
import { isFacultyExited } from "@/lib/auth/readOnlyFacultyLookup";

// The roles a login can act as RIGHT NOW: its primary role plus the role of
// every seat it holds (see types/roleSeats.ts). The session cookie carries a
// snapshot of these from sign-in, but a seat can be handed to someone else at
// any moment ("the previous holder loses the HOD modules as soon as the new
// person is assigned"), so guards re-read the person's own record - briefly
// cached, so a burst of requests costs one read, not one per request.
const TTL_MS = 20_000;
// `readOnly` is set only for a college that has the read-only-faculty switch ON
// (readOnlyAccess.ts) and a login linked to a RESIGNED/RETIRED faculty record:
//   "YES"     - their facultyMembers.status says so (the only source of truth);
//   "UNKNOWN" - the status lookup failed and there is no recent answer to reuse,
//               so WRITES are denied (fail closed) while reads carry on as before.
// It is absent for everyone else, so every other login/college is untouched.
interface CacheEntry { at: number; held: string[]; realRole: string; readOnly?: "YES" | "UNKNOWN" }
const cache = new Map<string, CacheEntry>();

interface SessionLike {
  uid: string;
  role: string;
  realRole?: string;
  roles?: string[];
  collegeId?: string;
  locationId?: string;
}

// When the live lookup itself fails (Firestore error/outage) we no longer trust
// the 24h-old cookie snapshot - that let a deactivated account keep acting during
// an outage. A recent cached answer for this login (up to STALE_OK_MS) still
// serves; with none, the login holds no roles, so guards answer 401 until the
// lookup works again.
const STALE_OK_MS = 5 * 60_000;
function failClosed(key: string, err: unknown): CacheEntry {
  console.error("[liveRoles] live role lookup failed", err);
  const stale = cache.get(key);
  if (stale && Date.now() - stale.at < STALE_OK_MS) return stale;
  return { at: 0, held: [], realRole: "" };
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
      // Seats handed over for someone's leave count only while that leave is
      // in progress (see lib/leave/roleDelegation.ts).
      const delegated = u.isActive === false ? [] : (await activeDelegatedRoles(getAdminDb(), session.collegeId, session.uid)).roles;
      const held = u.isActive === false ? [] : orderHeldRoles(rawRole, [...(u.seatRoles ?? []), ...delegated]);
      // Mirrors api/auth/session's realRole derivation: only COLLEGE_ADMIN and
      // DEPARTMENT_OFFICE ever diverge from the normalized `role`, and holding
      // the College Admin seat overrides even that - see SessionPayload.realRole.
      let realRole = rawRole === "COLLEGE_ADMIN" || rawRole === "DEPARTMENT_OFFICE" ? rawRole : session.role;
      if ((u.seatRoles ?? []).includes("COLLEGE_ADMIN")) realRole = "COLLEGE_ADMIN";
      const entry: CacheEntry = { at: Date.now(), held, realRole };
      // Read-only faculty: only when the college has the switch on, the account
      // is active and can be a faculty login. Any other login/college skips this
      // entirely - no extra read.
      if (held.length > 0 && isReadOnlyFacultyCollege(session.collegeId) && isFacultyCapableRole(rawRole)) {
        try {
          if (await isFacultyExited(getAdminDb(), session.collegeId, session.uid)) entry.readOnly = "YES";
        } catch (statusErr) {
          console.error("[liveRoles] faculty status lookup failed", statusErr);
          // Reuse a recent answer through a short outage; with none, deny writes only.
          entry.readOnly = hit && Date.now() - hit.at < STALE_OK_MS ? hit.readOnly : "UNKNOWN";
        }
      }
      cache.set(key, entry);
      return entry;
    } catch (err) {
      return failClosed(key, err);
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
  } catch (err) {
    return failClosed(key, err);
  }
}

// The HTTP method + path of the request being guarded, as stamped by proxy.ts on
// every /api request (always overwriting whatever the client sent). null when
// there is no request context (a script, a cron, a unit test) or the headers are
// missing - callers treat that as "not an allowed read", i.e. fail closed.
async function currentRequest(): Promise<{ method: string; path: string } | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const method = h.get(METHOD_HEADER);
    const path = h.get(PATH_HEADER);
    return method && path ? { method, path } : null;
  } catch {
    return null;
  }
}

// Applies the read-only rule AFTER the cache, per request, so one cached entry
// serves reads and writes correctly. For everyone without `readOnly` this returns
// the entry untouched.
//  - YES: the person keeps NO seat/administrative authority at all. They are
//    treated as a plain PANEL_MEMBER (so every existing own-data scoping branch in
//    the allowed GETs behaves exactly as it does for any faculty member) ONLY for
//    an allowed own-data read; for every other request they hold no roles, so
//    every guard answers 401.
//  - UNKNOWN: the lookup failed - deny writes, leave reads as they were.
async function applyReadOnly(entry: CacheEntry): Promise<CacheEntry> {
  if (!entry.readOnly) return entry;
  const req = await currentRequest();
  if (entry.readOnly === "YES") {
    return req && isAllowedReadOnlyRequest(req.method, req.path)
      ? { ...entry, held: ["PANEL_MEMBER"], realRole: "PANEL_MEMBER" }
      : { ...entry, held: [], realRole: "PANEL_MEMBER" };
  }
  return req && isReadMethod(req.method) ? entry : { ...entry, held: [] };
}

export async function resolveHeldRoles(session: SessionLike): Promise<string[]> {
  return (await applyReadOnly(await resolveLiveRoleInfo(session))).held;
}

// Live counterpart to SessionPayload.realRole (see verifySession.ts's
// isCollegeAdmin/isDepartmentOffice) - re-derived from Firestore on the same
// short TTL as resolveHeldRoles, so a role change takes effect within the
// cache window instead of only once the session cookie naturally expires.
export async function resolveRealRole(session: SessionLike): Promise<string> {
  return (await applyReadOnly(await resolveLiveRoleInfo(session))).realRole;
}

// Called right after a seat changes so the affected people don't wait out the
// cache window.
export function forgetHeldRoles(collegeId: string, uid: string): void {
  cache.delete(`${collegeId}/${uid}`);
}
