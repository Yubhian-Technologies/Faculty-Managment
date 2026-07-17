import type { Firestore } from "firebase-admin/firestore";
import type { UserRole } from "@/types";
import { ROLE_SCOPE } from "@/types";

// Shared notification helpers for the budget/indent/purchase-clearance
// flows (college/budget-requests, college/indent-requests,
// college/finance-purchase-clearance). Previously each route file carried
// its own copy-pasted notify()/notifyRole() pair; notifyRole's college-users
// query silently found zero recipients for FINANCE/PURCHASE_DEPT (GLOBAL
// roles whose profiles live in systemUsers, not colleges/{id}/users — see
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

// GLOBAL roles (FINANCE, PURCHASE_DEPT) live in systemUsers, not the college
// users subcollection. The notification is still stored under this college so
// the recipient sees it when acting on this college.
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
  const snap = isGlobal
    ? await db.collection("systemUsers").where("role", "==", role).get()
    : await db.collection("colleges").doc(collegeId).collection("users").where("role", "==", role).get();
  for (const u of snap.docs) {
    await notify(db, collegeId, u.id, type, title, message, link);
  }
}
