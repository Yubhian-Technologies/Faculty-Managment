import type { Firestore } from "firebase-admin/firestore";
import type { UserRole } from "@/types";
import { ROLE_SCOPE } from "@/types";
import { findUsersByRoles } from "@/lib/roles/findUsersByRoles";
import { orderHeldRoles } from "@/lib/roles/seatRoles";

// Shared notification helpers for the budget/indent/purchase-clearance
// flows (college/budget-requests, college/indent-requests,
// college/finance-purchase-clearance). Previously each route file carried
// its own copy-pasted notify()/notifyRole() pair; notifyRole's college-users
// query silently found zero recipients for FINANCE/PURCHASE_DEPT (GLOBAL
// roles whose profiles live in systemUsers, not colleges/{id}/users - see
// ROLE_SCOPE in src/types/core.ts), so those roles never got notified by
// three of the four call sites. Centralizing here fixes that once instead
// of per-file.

export async function notify(
  db: Firestore,
  collegeId: string,
  toUid: string,
  type: string,
  title: string,
  message: string,
  link?: string
) {
  try {
    await db.collection("colleges").doc(collegeId).collection("notifications").add({
      collegeId, toUid, type, title, message,
      read: false, link: link ?? null, createdAt: new Date(),
    });
  } catch {
    /* non-fatal */
  }
}

// Principal/VP/College Admin are locked into every interview panel, but the
// panel-stage prompts (candidate arrived, scoring open, feedback unlocked) are
// meant for the HOD-side panel and would only be noise on their bell. Keeps
// only the panel uids whose role is not one of those leadership roles.
const LEADERSHIP_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN", "DIRECTOR"];

export async function excludeLeadershipUids(
  db: Firestore,
  collegeId: string,
  uids: string[]
): Promise<string[]> {
  if (uids.length === 0) return [];
  const usersCol = db.collection("colleges").doc(collegeId).collection("users");
  const snaps = await Promise.all(uids.map((uid) => usersCol.doc(uid).get()));
  return snaps
    .filter((s) => {
      if (!s.exists) return true;
      // A faculty member who holds the Principal/VP seat counts as leadership
      // too, not only accounts whose own primary role is one.
      const u = s.data() as { role?: string; seatRoles?: string[] };
      return !orderHeldRoles(u.role ?? "", u.seatRoles ?? []).some((r) => LEADERSHIP_ROLES.includes(r));
    })
    .map((s) => s.id);
}

// Everyone who acts for a department on hiring: its HOD(s) and its Department
// Office head (same authority as the HOD). A request/batch stores only the one
// person who raised it, so notifying just that uid would leave the other
// out of their own department's hiring. `alwaysUids` (the stored hodUid) is
// always included so the original requester is never dropped.
export async function getDepartmentHeadUids(
  db: Firestore,
  collegeId: string,
  department: string | undefined,
  ...alwaysUids: (string | undefined)[]
): Promise<string[]> {
  const uids = new Set<string>(alwaysUids.filter((u): u is string => !!u));
  if (department) {
    const collegeRef = db.collection("colleges").doc(collegeId);
    const [deptSnap, heads] = await Promise.all([
      collegeRef.collection("departments").where("name", "==", department).get(),
      // findUsersByRoles also reaches a faculty member who holds the HOD seat.
      findUsersByRoles(db, collegeId, ["HOD"]),
    ]);
    for (const d of deptSnap.docs) {
      const hodUid = (d.data() as { hodUid?: string }).hodUid;
      if (hodUid) uids.add(hodUid);
    }
    for (const u of heads) {
      if ((u.data() as { department?: string }).department === department) uids.add(u.id);
    }
  }
  return [...uids];
}

// GLOBAL roles (FINANCE, PURCHASE_DEPT) live in systemUsers, not the college
// users subcollection. The notification is still stored under this college so
// the recipient sees it when acting on this college.
//
// College Admin and Director both mirror Principal's authority end-to-end
// (see UserRole's own doc-comment) but keep their real "COLLEGE_ADMIN"/
// "DIRECTOR" role in Firestore, so a caller asking to notify "PRINCIPAL" here
// also reaches every College Admin and Director - otherwise every
// notifyRole(..., "PRINCIPAL", ...) call site across the
// budget/indent/purchase-clearance/leave/hiring flows would need its own
// duplicate call to cover them, and silently drift out of sync as new ones
// are added.
export async function notifyRole(
  db: Firestore,
  collegeId: string,
  role: string,
  type: string,
  title: string,
  message: string,
  link?: string
) {
  const isGlobal = ROLE_SCOPE[role as UserRole] === "GLOBAL";
  // Same reasoning for a Department Office head, whose authority mirrors their
  // HOD end-to-end: a notifyRole(..., "HOD", ...) must reach them too, or they
  // would silently miss every role-broadcast their HOD acts on.
  // findUsersByRoles also reaches whoever holds a SEAT of this role (see
  // types/roleSeats.ts) - e.g. a faculty member who is the current HOD - not
  // just accounts whose own primary role matches.
  const docs = isGlobal
    ? (await db.collection("systemUsers").where("role", "==", role).get()).docs
    : await findUsersByRoles(db, collegeId, [role]);
  for (const u of docs) {
    await notify(db, collegeId, u.id, type, title, message, link);
  }
}
