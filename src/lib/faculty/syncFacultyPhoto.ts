import type { Firestore } from "firebase-admin/firestore";

/**
 * A faculty member's photo lives on their FACULTY record (facultyMembers.
 * profilePhotoUrl) - that is the source of truth every faculty list reads. The
 * `users` record's profilePhotoUrl is only a mirror for the nav/avatar.
 *
 * Every login-side route that changes a person's photo calls this FIRST, so the
 * source of truth is written before the mirror: if this throws, the caller must
 * not touch the mirror (the request fails and both stay as they were). A login
 * with no linked faculty record (Principal, office staff, ...) simply has no
 * faculty record to update - returns false and the caller carries on as before.
 *
 * An explicit "" (the person removed their photo) is written as well, so the
 * photo is cleared in both places; it is never called for a request that did not
 * mention the photo.
 */
export async function setLinkedFacultyPhoto(
  db: Firestore,
  collegeId: string,
  uid: string,
  photoUrl: string
): Promise<boolean> {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("facultyMembers")
    .where("userUid", "==", uid)
    .limit(1)
    .get();
  if (snap.empty) return false;
  await snap.docs[0].ref.update({ profilePhotoUrl: photoUrl, updatedAt: new Date() });
  return true;
}
