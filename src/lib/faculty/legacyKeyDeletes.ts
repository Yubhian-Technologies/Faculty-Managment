// Companion to fieldRenames.ts for WRITE paths that update an EXISTING doc.
//
// Routes now write only the new key names. A doc that has not been through
// scripts/migrate-faculty-field-names.mjs yet may still carry the old-named twin
// of a key being written, and Firestore would happily store both. These helpers
// mark that old twin for deletion (pass FieldValue.delete() as `deleteSentinel`)
// so a doc never ends up holding both.
//
// An old key whose replacement is NOT part of this write is left alone - a
// partial PATCH must not lose data it didn't touch. (Reads keep working either
// way, via migrateFacultyDoc & co.)

import { PERSONAL_KEY_RENAMES, FACULTY_DOC_KEY_RENAMES } from "./fieldRenames";

export function withLegacyKeysDeleted(
  updates: Record<string, unknown>,
  renames: Record<string, string>,
  deleteSentinel: unknown,
): Record<string, unknown> {
  const out = { ...updates };
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (newKey in updates) out[oldKey] = deleteSentinel;
  }
  return out;
}

// users / supportingStaff docs: the flat personal keys only.
export function withLegacyPersonalKeysDeleted(updates: Record<string, unknown>, deleteSentinel: unknown) {
  return withLegacyKeysDeleted(updates, PERSONAL_KEY_RENAMES, deleteSentinel);
}

// facultyMembers docs: personal keys + qualification/experienceYears.
export function withLegacyFacultyKeysDeleted(updates: Record<string, unknown>, deleteSentinel: unknown) {
  return withLegacyKeysDeleted(updates, { ...PERSONAL_KEY_RENAMES, ...FACULTY_DOC_KEY_RENAMES }, deleteSentinel);
}
