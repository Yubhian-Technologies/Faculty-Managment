import type { Firestore } from "firebase-admin/firestore";
import { resolveEmployeeIdentity } from "./identity";
import { PROFILES_COL } from "./balanceEngine";
import type { EmployeeLeaveProfile } from "@/types/leave";

// Auto-creates a leave profile from FacultyMember/user defaults on first
// lookup - no manual "setup" step needed. Returns null only if the uid has no
// resolvable identity in this college at all.
export async function getOrCreateProfile(
  db: Firestore,
  collegeId: string,
  uid: string
): Promise<EmployeeLeaveProfile | null> {
  const ref = PROFILES_COL(collegeId, db).doc(uid);
  const snap = await ref.get();
  if (snap.exists) return { id: snap.id, ...snap.data() } as EmployeeLeaveProfile;

  const identity = await resolveEmployeeIdentity(db, collegeId, uid);
  if (!identity) return null;

  const now = new Date();
  const newProfile: Omit<EmployeeLeaveProfile, "id"> = {
    collegeId,
    uid,
    staffCategory: identity.isTeachingStaff ? "vacation" : "non-vacation",
    isTeachingStaff: identity.isTeachingStaff,
    dateOfJoining: identity.dateOfJoining as unknown as EmployeeLeaveProfile["dateOfJoining"],
    department: identity.department,
    createdAt: now as unknown as EmployeeLeaveProfile["createdAt"],
    updatedAt: now as unknown as EmployeeLeaveProfile["updatedAt"],
  };
  await ref.set(newProfile);
  return { id: uid, ...newProfile };
}
