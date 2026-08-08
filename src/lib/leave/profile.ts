import type { Firestore } from "firebase-admin/firestore";
import { resolveEmployeeIdentity } from "./identity";
import { PROFILES_COL } from "./balanceEngine";
import type { EmployeeLeaveProfile } from "@/types/leave";

type TimestampLike = { toMillis?: () => number; toDate?: () => Date } | Date | undefined;

function toMillis(v: TimestampLike): number | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  return undefined;
}

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
  if (snap.exists) {
    const existing = { id: snap.id, ...snap.data() } as EmployeeLeaveProfile;
    // Self-heal a profile nobody has ever hand-edited via the Leave Profile
    // edit screen (createdAt === updatedAt is that signal - a manual PUT
    // always bumps updatedAt) against the *current* identity-resolution
    // logic. Without this, a profile auto-created before a fix to
    // resolveEmployeeIdentity (e.g. the HOD/Principal/VP dateOfJoining
    // back-dating in identity.ts) stays wrong forever - the code path only
    // ever runs on first creation, so the bug outlives its own fix until
    // someone manually deletes/edits the stale doc.
    const neverManuallyEdited = toMillis(existing.createdAt) === toMillis(existing.updatedAt);
    if (neverManuallyEdited) {
      const identity = await resolveEmployeeIdentity(db, collegeId, uid);
      if (identity) {
        const freshStaffCategory: EmployeeLeaveProfile["staffCategory"] = identity.isTeachingStaff ? "vacation" : "non-vacation";
        const changed =
          existing.staffCategory !== freshStaffCategory ||
          existing.isTeachingStaff !== identity.isTeachingStaff ||
          toMillis(existing.dateOfJoining) !== identity.dateOfJoining.getTime();
        if (changed) {
          const healed = {
            staffCategory: freshStaffCategory,
            isTeachingStaff: identity.isTeachingStaff,
            dateOfJoining: identity.dateOfJoining as unknown as EmployeeLeaveProfile["dateOfJoining"],
          };
          // updatedAt is deliberately left untouched - bumping it would make
          // this look "manually edited" and disable self-healing for any
          // future identity-resolution fix.
          await ref.update(healed);
          return { ...existing, ...healed };
        }
      }
    }
    return existing;
  }

  const identity = await resolveEmployeeIdentity(db, collegeId, uid);
  if (!identity) return null;

  const now = new Date();
  const newProfile: Omit<EmployeeLeaveProfile, "id"> = {
    collegeId,
    uid,
    staffCategory: identity.isTeachingStaff ? "vacation" : "non-vacation",
    isTeachingStaff: identity.isTeachingStaff,
    dateOfJoining: identity.dateOfJoining as unknown as EmployeeLeaveProfile["dateOfJoining"],
    ...(identity.department ? { department: identity.department } : {}),
    createdAt: now as unknown as EmployeeLeaveProfile["createdAt"],
    updatedAt: now as unknown as EmployeeLeaveProfile["updatedAt"],
  };
  await ref.set(newProfile);
  return { id: uid, ...newProfile };
}
