// Student passwords are chosen by the college office (typed when a login is
// created or reset, or supplied in the import file) - the system never invents
// one. They live only in Firebase Auth: nothing here stores, logs or returns a
// password, and no Firestore document ever holds one.
//
// Firebase itself accepts 6+ characters; 8 matches what faculty/staff logins
// already require.

export const STUDENT_PASSWORD_MIN_LENGTH = 8;
export const STUDENT_PASSWORD_MAX_LENGTH = 128;

/** A human-readable problem with this password, or null when it is acceptable. */
export function studentPasswordError(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) return "A password is required";
  if (password.length < STUDENT_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${STUDENT_PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > STUDENT_PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${STUDENT_PASSWORD_MAX_LENGTH} characters`;
  }
  // A stray space copied out of a spreadsheet cell would silently make the
  // password differ from what the student is told.
  if (password !== password.trim()) return "Password must not start or end with a space";
  return null;
}
