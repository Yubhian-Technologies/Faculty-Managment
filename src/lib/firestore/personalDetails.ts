// Shared field set for the personal/statutory details captured on FacultyMember
// and FMSUser records (Principal, Staff, Faculty add/edit forms).

export interface PersonalDetailsInput {
  gender?: string;
  dateOfBirth?: string;        // yyyy-mm-dd
  legalName?: string;
  fatherName?: string;
  motherName?: string;
  religion?: string;
  caste?: string;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNumber?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  ratificationStatus?: string;
  ratificationDate?: string;   // yyyy-mm-dd
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string;
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;
  bloodGroup?: string;
}

const STRING_FIELDS = [
  "gender", "legalName", "fatherName", "motherName", "religion", "caste", "subCaste", "aadharNo", "ratificationStatus",
  "passportNumber", "emergencyContactName", "emergencyContactPhone",
  "maritalStatus", "spouseName", "referral", "nativePlace", "temporaryAddress", "permanentAddress", "bloodGroup",
] as const;

// The manual Add/Edit forms only ever write "Ratified" or "Not Ratified"
// (PersonalDetailsFields.tsx's Select is restricted to those two values), but
// CSV import takes free text straight from a spreadsheet cell. Without this,
// import stored whatever the cell said verbatim - a college's "Approved"/
// "Pending" column showed up as-is on the faculty list (looking like a
// second, undocumented status) instead of collapsing to the same two values
// manual entry can ever produce. Recognizes common synonyms; anything else is
// left unset rather than guessed at (the caller should report it as dropped,
// same as an unparseable date - see faculty/import/route.ts's `dropped()`).
const NOT_RATIFIED_WORDS = new Set(["not ratified", "pending", "no", "awaiting", "in progress", "rejected"]);
const RATIFIED_WORDS = new Set(["ratified", "approved", "yes", "done", "complete", "completed"]);

export function normalizeRatificationStatus(raw: string | undefined): "Ratified" | "Not Ratified" | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  // Check the "not ratified" family first - "not approved" contains "approved"
  // and must resolve to Not Ratified, not Ratified.
  if (v.includes("not") || NOT_RATIFIED_WORDS.has(v)) return "Not Ratified";
  if (RATIFIED_WORDS.has(v)) return "Ratified";
  return undefined;
}

// Builds a Firestore update/set fragment from whichever personal-detail keys are
// present on `body`. Only keys that were actually sent are included, so this is
// safe to spread into both create (full body) and PATCH (partial body) writes.
export function buildPersonalDetailsUpdate(body: PersonalDetailsInput): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const key of STRING_FIELDS) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.panNo !== undefined) updates.panNo = body.panNo.toUpperCase();
  if (body.dateOfBirth) updates.dateOfBirth = new Date(body.dateOfBirth);
  if (body.ratificationDate) updates.ratificationDate = new Date(body.ratificationDate);
  if (body.numberOfChildren !== undefined) updates.numberOfChildren = body.numberOfChildren;
  if (body.permanentSameAsTemporary !== undefined) updates.permanentSameAsTemporary = body.permanentSameAsTemporary;
  return updates;
}
