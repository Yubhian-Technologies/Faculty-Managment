// Student login identity. Browser-safe (the login page imports it) - nothing
// here may touch node-only APIs.
//
// A student signs in with their Roll Number. Roll numbers are GLOBALLY unique -
// across every college, compared after normalisation - so the roll alone is the
// identity and the login page needs no college picker. Firebase Auth needs an
// email, so each student login owns a synthetic, non-deliverable one.
//
// NORMALISATION: a roll is reduced to its letters and digits, lower-cased, so
// "24PA1A0501", "24pa1a0501", " 24 PA1A0501 " and "24-PA1A0501" are ONE identity
// and cannot become two accounts. That key names the global registry document
// (studentUsernames/{KEY}, see rollIdentity.ts) and the email of every NEW login:
//   <rollKey>@students.internal
//
// LEGACY accounts were created as <roll lower-cased, only a-z 0-9 . _ - kept>
// @students.internal - which keeps punctuation, so for a roll like "24-PA1A0501"
// it differs from the normalised form. Those accounts keep whatever `loginEmail`
// is stored on the student document (it is never recomputed); studentLoginEmail()
// survives only so the login page can try that legacy form directly.

export const STUDENT_LOGIN_DOMAIN = "students.internal";

/** Roll reduced to its letters and digits, lower-case. "" when nothing is left. */
export function studentRollKey(roll: string): string {
  return roll.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The case-insensitive value stored as `rollNumberUpper` (trimmed, upper-cased). */
export function rollNumberUpperOf(roll: unknown): string {
  return typeof roll === "string" ? roll.trim().toUpperCase() : "";
}

/** Id of the global registry document for a roll: the normalised key, upper-case. */
export function studentRollDocId(roll: string): string {
  return studentRollKey(roll).toUpperCase();
}

/** Login email for a NEW student login - derived from the normalised roll alone. */
export function studentLoginEmailForRoll(roll: string): string {
  return `${studentRollKey(roll)}@${STUDENT_LOGIN_DOMAIN}`;
}

/**
 * LEGACY roll-only login email. Kept for the login page's direct attempt at an
 * old account (cheap, no database read) and as the answer for a roll nobody has
 * a login for - never use it to create a login.
 */
export function studentLoginEmail(rollNumberOrDocId: string): string {
  const clean = rollNumberOrDocId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${clean}@${STUDENT_LOGIN_DOMAIN}`;
}
