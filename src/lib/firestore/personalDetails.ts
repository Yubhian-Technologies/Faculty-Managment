// Shared field set for the personal/statutory details captured on FacultyMember
// and FMSUser records (Principal, Staff, Faculty add/edit forms).

export interface PersonalDetailsInput {
  gender?: string;
  dateOfBirth?: string;        // yyyy-mm-dd
  legalName?: string;
  nameAsPerAadhar?: string;
  fatherName?: string;
  motherName?: string;
  religion?: string;
  caste?: string;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNumber?: string;
  sscHallTicketNo?: string;
  differentlyAbled?: boolean;
  differentlyAbledDetails?: string;
  bankAccountNo?: string;
  ifscCode?: string;
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

// permanentAddress is deliberately NOT in this list - see the dedicated
// handling in buildPersonalDetailsUpdate below, which overrides it with
// temporaryAddress whenever permanentSameAsTemporary is true rather than
// passing through whatever (if anything) the caller sent for it.
const STRING_FIELDS = [
  "gender", "legalName", "nameAsPerAadhar", "fatherName", "motherName", "religion", "caste", "subCaste", "aadharNo", "ratificationStatus",
  "passportNumber", "sscHallTicketNo", "differentlyAbledDetails", "bankAccountNo", "emergencyContactName", "emergencyContactPhone",
  "maritalStatus", "spouseName", "referral", "nativePlace", "temporaryAddress", "bloodGroup",
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
  if (body.ifscCode !== undefined) updates.ifscCode = body.ifscCode.toUpperCase();
  if (body.dateOfBirth) updates.dateOfBirth = new Date(body.dateOfBirth);
  if (body.ratificationDate) updates.ratificationDate = new Date(body.ratificationDate);
  if (body.numberOfChildren !== undefined) updates.numberOfChildren = body.numberOfChildren;
  if (body.permanentSameAsTemporary !== undefined) updates.permanentSameAsTemporary = body.permanentSameAsTemporary;
  if (body.differentlyAbled !== undefined) updates.differentlyAbled = body.differentlyAbled;
  // "Same as temporary" means exactly that - the permanent address is set to
  // whatever temporary address came in on the same call, not left blank and
  // not trusting a stray permanentAddress value the caller might also have
  // sent. Only applies when temporaryAddress is actually part of this call
  // (both a full manual-form save and a CSV import row always send both
  // together); a partial update that touches only the flag leaves the stored
  // address alone rather than guessing.
  if (body.permanentSameAsTemporary === true && body.temporaryAddress !== undefined) {
    updates.permanentAddress = body.temporaryAddress;
  } else if (body.permanentAddress !== undefined) {
    updates.permanentAddress = body.permanentAddress;
  }
  return updates;
}
