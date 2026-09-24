// Single Responsibility: permission evaluation for circular SEND.
// Open/Closed: new roles/scopes added without editing evaluation logic.
// Dependency Inversion: callers depend on canSendCircular() abstraction.

import type { Firestore } from "firebase-admin/firestore";
import type { UserRole } from "@/types/core";
import type { CircularPermissionsDoc } from "@/types/circular";

const PERMS_DOC = "circularPermissions";

function permsRef(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("settings").doc(PERMS_DOC);
}

export async function getCircularPermissions(db: Firestore, collegeId: string): Promise<CircularPermissionsDoc | null> {
  const snap = await permsRef(db, collegeId).get();
  return snap.exists ? (snap.data() as CircularPermissionsDoc) : null;
}

export async function saveCircularPermissions(
  db: Firestore,
  collegeId: string,
  allowedUids: string[],
  allowedRoles: UserRole[],
  actor: { uid: string; name: string }
): Promise<CircularPermissionsDoc> {
  const now = new Date() as unknown as CircularPermissionsDoc["updatedAt"];
  const payload: CircularPermissionsDoc = {
    collegeId,
    allowedUids: [...new Set(allowedUids.map((s) => s.trim()).filter(Boolean))],
    allowedRoles: [...new Set(allowedRoles)] as UserRole[],
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByName: actor.name,
  };
  await permsRef(db, collegeId).set(payload, { merge: true });
  return payload;
}

// PRINCIPAL and COLLEGE_ADMIN (normalized to PRINCIPAL) always can send.
// Otherwise, allowed if uid in allowedUids OR role in allowedRoles.
export async function canSendCircular(
  db: Firestore,
  collegeId: string,
  uid: string,
  role: UserRole,
  realRole?: UserRole
): Promise<boolean> {
  if (role === "PRINCIPAL" || role === "VICE_PRINCIPAL" || realRole === "COLLEGE_ADMIN") return true;
  // Management/FINANCE etc. are GLOBAL but principal may still delegate; treat like college roles here
  const perms = await getCircularPermissions(db, collegeId);
  if (!perms) return false;
  if (perms.allowedUids.includes(uid)) return true;
  if (perms.allowedRoles.includes(role)) return true;
  if (realRole && perms.allowedRoles.includes(realRole)) return true;
  return false;
}

export async function requireCanSendCircular(
  db: Firestore,
  collegeId: string,
  uid: string,
  role: UserRole,
  realRole?: UserRole
): Promise<void> {
  const ok = await canSendCircular(db, collegeId, uid, role, realRole);
  if (!ok) throw new Error("FORBIDDEN_CIRCULAR");
}
