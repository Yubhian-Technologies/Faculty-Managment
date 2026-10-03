import type { Firestore } from "firebase-admin/firestore";
import { rollNumberUpperOf, studentLoginEmail, studentRollDocId, studentRollKey } from "@/lib/students/loginDefaults";

// Maps what a student typed (a Roll Number) to the Firebase Auth email(s) that
// could belong to them. Roll numbers are globally unique, so this is a plain
// lookup by document id - no query, no index, no college involved:
//  1. the global registry document for the normalised roll (studentUsernames/{KEY}) -
//     how every account created since the registry existed, and every renamed
//     roll, is found;
//  2. the legacy lookup document whose id is the upper-cased roll as typed
//     (accounts from before normalisation, e.g. "24-PA1A0501").
// Accounts older than any lookup document are reached by the login page's own
// direct attempt at the legacy email, which needs no database read.
// A document marked `active: false` (a retired roll) or with no login on it is ignored.
// At most two emails come back (the normalised and the legacy form of one roll).

export const MAX_ROLL_LENGTH = 64;

interface UsernameDoc {
  loginEmail?: string;
  active?: boolean;
}

export async function findStudentLoginEmails(db: Firestore, roll: string): Promise<string[]> {
  const trimmed = roll.trim();
  const emails: string[] = [];
  const add = (data: UsernameDoc | undefined) => {
    if (data && data.active !== false && typeof data.loginEmail === "string" && data.loginEmail && !emails.includes(data.loginEmail)) {
      emails.push(data.loginEmail);
    }
  };

  const keyId = studentRollKey(trimmed) ? studentRollDocId(trimmed) : "";
  if (keyId) {
    const snap = await db.collection("studentUsernames").doc(keyId).get();
    if (snap.exists) add(snap.data() as UsernameDoc);
  }

  const legacyId = rollNumberUpperOf(trimmed);
  // A document id cannot contain "/" - such a roll cannot have a legacy document.
  if (legacyId && legacyId !== keyId && !legacyId.includes("/")) {
    const snap = await db.collection("studentUsernames").doc(legacyId).get();
    if (snap.exists) add(snap.data() as UsernameDoc);
  }
  return emails;
}

/**
 * What to answer for a roll nobody has a login for. Never a "not found": a
 * guessable-looking email that simply fails to sign in, exactly like a wrong
 * password, so this endpoint cannot be used to learn which roll numbers exist.
 */
export function placeholderLoginEmail(roll: string): string {
  return studentLoginEmail(roll);
}
