import type { Firestore } from "firebase-admin/firestore";

// The College Admin can always open and change everything in its college, so no workflow stalls when someone
// doesn't do their part: besides its own Principal / College Office side, a College Admin login always holds the
// roles below - and HOD of EVERY department. Folded into the login's held roles by lib/leave/roleDelegation.ts
// (activeDelegatedRoles - the path the leave role handover uses), so the guards, the session's roles (page access),
// the HOD department scope and the menus' "Working as" switcher follow with no change to verifySession / scope.
// It never adds the College Admin to anyone's notifications (findActiveDelegates is not touched).

export const COLLEGE_ADMIN_EXTRA_ROLES = [
  "HOD", "EXAM_CELL", "ACADEMICS", "LIBRARY", "T_AND_P", "PLACEMENT_DEPT", "IQAC_COORDINATOR", "HOSTEL",
] as const;

const TTL_MS = 60_000;
const deptCache = new Map<string, { at: number; value: Promise<string[]> }>();

/** Every active department name of the college (60 s per server instance). */
function allDepartments(db: Firestore, c: string): Promise<string[]> {
  const hit = deptCache.get(c);
  if (hit && Date.now() - hit.at < TTL_MS && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  const value = db.collection("colleges").doc(c).collection("departments").select("name", "isActive").get()
    .then((s) => s.docs.filter((d) => d.get("isActive") !== false).map((d) => String(d.get("name") ?? "")).filter(Boolean));
  value.catch(() => deptCache.delete(c));
  deptCache.set(c, { at: Date.now(), value });
  return value;
}

/** A College Admin login's always-on roles and departments; empty for anyone else. */
export async function collegeAdminPowers(db: Firestore, c: string, uid: string): Promise<{ roles: string[]; departments: string[] }> {
  const u = (await db.collection("colleges").doc(c).collection("users").doc(uid).get()).data() as { role?: string; seatRoles?: string[]; isActive?: boolean } | undefined;
  const isAdmin = !!u && u.isActive !== false && (u.role === "COLLEGE_ADMIN" || (u.seatRoles ?? []).includes("COLLEGE_ADMIN"));
  if (!isAdmin) return { roles: [], departments: [] };
  return { roles: [...COLLEGE_ADMIN_EXTRA_ROLES], departments: await allDepartments(db, c) };
}
