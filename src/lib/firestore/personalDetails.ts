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
  "gender", "legalName", "fatherName", "motherName", "religion", "caste", "aadharNo", "ratificationStatus",
  "passportNumber", "emergencyContactName", "emergencyContactPhone",
  "maritalStatus", "spouseName", "referral", "nativePlace", "temporaryAddress", "permanentAddress", "bloodGroup",
] as const;

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
