import type { Firestore } from "firebase-admin/firestore";
import { istDateKey } from "@/lib/attendance/istTime";
import { isSeatRole, normalizeStoredRole } from "@/lib/roles/seatRoles";
import type { LeaveRequest } from "@/types/leave";

// Role handover during leave: a requester holding seat roles (HOD, Principal,
// ...) names someone to act in those seats while they're out. There is no
// separate record - the delegation lives on the leave request itself
// (roleHandover* fields) and is live only while that request is APPROVED and
// today (IST) falls inside its dates, so cancelling or rejecting the leave
// ends it with no extra bookkeeping. Guards (lib/auth/liveRoles.ts) and the
// session route both fold these roles into the delegate's held roles.
export interface ActiveDelegation {
  roles: string[];
  departments: string[];
}

export async function activeDelegatedRoles(
  db: Firestore,
  collegeId: string,
  uid: string
): Promise<ActiveDelegation> {
  const today = istDateKey();
  const snap = await db.collection("colleges").doc(collegeId).collection("leaveRequests")
    .where("roleHandoverToUid", "==", uid)
    .where("status", "==", "APPROVED")
    .get();
  const roles = new Set<string>();
  const departments = new Set<string>();
  for (const d of snap.docs) {
    const r = d.data() as Partial<LeaveRequest>;
    if (!r.roleHandoverFrom || !r.roleHandoverTo || today < r.roleHandoverFrom || today > r.roleHandoverTo) continue;
    for (const role of r.roleHandoverRoles ?? []) roles.add(role);
    for (const dept of r.roleHandoverDepartments ?? []) departments.add(dept);
  }
  return { roles: Array.from(roles), departments: Array.from(departments) };
}

// The seat roles a requester could hand over: seats held plus a legacy
// role-login whose own role is a seat role.
export function handoverableRoles(profile: { role?: string; seatRoles?: string[] } | undefined): string[] {
  const all = [profile?.role ?? "", ...(profile?.seatRoles ?? [])].map(normalizeStoredRole);
  return Array.from(new Set(all.filter((r) => isSeatRole(r))));
}
