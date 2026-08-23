// Shared "is this roll-less row actually the same person" check, used by both
// the bulk importer's unassigned rows (college/students/import-excel) and the
// single Add Student / "Fix Row" endpoint (college/students POST) - one
// implementation instead of two, so a row rejected by one is rejected by the
// other too (previously the single endpoint had no de-dupe check at all,
// which let the import page's "Fix Row" dialog silently create a real
// duplicate when saved without actually correcting anything).

/**
 * Fields strong enough to independently confirm two roll-less student rows
 * are the SAME PERSON, beyond just sharing a name - a college roster
 * genuinely has students who share a common name (e.g. two different "Rahul
 * Kumar"s), so name + department + year alone is not enough to call
 * something a duplicate. A real identifier like an email, mobile number or
 * Aadhar number matching too is a much stronger signal.
 */
export const STRONG_IDENTITY_FIELDS = [
  "email", "mobileNo", "guardianContact", "aadharNo",
  "admissionNo", "hallTicketNo", "dateOfBirth", "rationCardNo",
  "bankAccountNo", "entranceRank",
] as const;

function normalize(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim().toLowerCase();
}

/**
 * True when `candidate` (a new roll-less row being added/imported) is likely
 * the same person as `existing` (an already-saved unassigned student with a
 * matching name/department/year - the caller narrows to these before calling
 * this). Requires at least one of STRONG_IDENTITY_FIELDS to be present on
 * BOTH sides and agree; any field present on both sides that DISAGREES rules
 * out a match outright, even if another field agreed (a mismatched email is
 * strong evidence of two different people, however similar the rest looks).
 * When neither record has any strong field filled in, there's no way to tell
 * two same-named students apart from data alone, so this deliberately
 * returns false (allow the import) rather than block on a name coincidence.
 */
export function isLikelySameUnassignedStudent(
  candidate: Record<string, unknown>,
  existing: Record<string, unknown>
): boolean {
  let corroborated = false;
  for (const key of STRONG_IDENTITY_FIELDS) {
    const a = normalize(candidate[key]);
    const b = normalize(existing[key]);
    if (!a || !b) continue;
    if (a !== b) return false;
    corroborated = true;
  }
  return corroborated;
}
