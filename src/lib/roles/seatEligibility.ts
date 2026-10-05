import type { Firestore } from "firebase-admin/firestore";
import { isFacultyExited } from "@/lib/auth/readOnlyFacultyLookup";

/**
 * Whether a person may be GIVEN a (new) seat right now. A RESIGNED/RETIRED faculty member has read-only
 * access and holds no authority, so appointing them to a seat would only put a name on a seat nobody can
 * act in. facultyMembers.status is the only source of truth (the same one the read-only rule uses).
 *
 * Returns null when the appointment may go ahead, or the reason it may not.
 *
 *  - Applies to every college (no switch).
 *  - It only ever guards a NEW appointment. It is never called when a seat is vacated or when an existing
 *    holder is left in place - an existing seat, holder or history entry is never touched by this check.
 *  - FAILS CLOSED: if the status lookup fails the appointment is refused (try again), never waved through.
 *  - A login with no faculty record (Principal, College Admin, office staff) is simply allowed.
 */
export async function seatBlockReason(
  db: Firestore,
  collegeId: string,
  uid: string,
  name?: string
): Promise<{ message: string; status: number } | null> {
  try {
    if (await isFacultyExited(db, collegeId, uid)) {
      return {
        message: `${name?.trim() || "This person"} is resigned or retired and has read-only access - set them back to Active before giving them a seat`,
        status: 409,
      };
    }
    return null;
  } catch (err) {
    console.error("[seatEligibility] faculty status lookup failed", err);
    return { message: "Couldn't check whether this person is still an active faculty member - please try again", status: 503 };
  }
}
