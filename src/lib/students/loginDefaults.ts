// Every student login is created (and reset) with this same shared password -
// not a per-student value - per product decision: simplest to communicate to
// a whole batch at once, no forced change on first login. College Office can
// reset any student back to this exact value later if they forget it.
export const DEFAULT_STUDENT_PASSWORD = "Student@123";

// Synthetic, globally-unique Firebase Auth email for a student login - derived
// deterministically from the student's unique Roll Number (or docId as fallback)
// so the login page can authenticate students directly with zero database lookups.
export function studentLoginEmail(rollNumberOrDocId: string): string {
  const clean = rollNumberOrDocId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${clean}@students.internal`;
}
