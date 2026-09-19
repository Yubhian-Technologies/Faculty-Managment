// Read/write normaliser for `academicProfile` (facultyMembers/users) and for the
// Supporting Staff profile's shared-shape lists.
//
// The full old->new key registry lives in fieldRenames.ts; this file is the
// thin app-facing entry point over it. Live Firestore docs keep their legacy key
// names until scripts/migrate-faculty-field-names.mjs has run, so every consumer
// that reads, and every server route that persists, an academicProfile goes
// through normalizeAcademicProfile() - a record in the legacy shape is lifted to
// the current one (Qualification, Experience, Professional Development and
// Financial tabs alike), and a record already in the current shape passes
// through untouched.
//
// Same semantics as fieldRenames.ts: idempotent, and when a record has both the
// old and the new key the new one wins.

import { migrateAcademicProfile, migrateSupportingStaffDoc } from "./fieldRenames";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

export function normalizeAcademicProfile<T>(ap: T): T {
  return migrateAcademicProfile(ap) as T;
}

// Supporting Staff equivalent: normalises supportingStaffProfile's
// qualifications (StaffQualification list, same shape as
// educationalQualifications) plus nonTechnicalProfile.training (TrainingEntry
// list) and .achievements (AwardEntry list).
export function normalizeSupportingStaffProfile<T>(sp: T): T {
  if (!isObj(sp)) return sp;
  const migrated = migrateSupportingStaffDoc({ supportingStaffProfile: sp }).supportingStaffProfile;
  return migrated as T;
}
