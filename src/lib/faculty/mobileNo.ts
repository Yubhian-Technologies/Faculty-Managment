// FacultyMember "Mobile No" is stored as `mobileNo` (it used to be `phone` - see
// FACULTY_DOC_KEY_RENAMES in fieldRenames.ts and
// scripts/migrate-faculty-phone-to-mobileno.mjs). SupportingStaffMember's own
// `phone` was renamed to `mobileNo` too (SUPPORTING_STAFF_DOC_KEY_RENAMES),
// same field name, same rename-migration mechanism.
//
// `users.phone` (FMSUser), `candidates.phone` and the other `phone` fields on
// different record shapes are different entities and keep their names.

type Contactable = { mobileNo?: unknown; phone?: unknown };

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// The Mobile No of a record that might be a facultyMembers doc (`mobileNo`, or the old
// `phone` on one not yet migrated) or a users doc (always `phone` - the FMSUser contact
// field). Shared displays (FacultyProfileHub, the resume) receive both shapes.
export function facultyMobileNo(rec: Contactable | null | undefined): string | undefined {
  if (!rec) return undefined;
  const m = str(rec.mobileNo);
  if (m !== undefined && m.trim() !== "") return m;
  return str(rec.phone) ?? m;
}

// Request bodies: `mobileNo` is the field; a `phone` key is still accepted for one release
// so a browser tab opened before the deploy can finish saving. Remove after that.
export function mobileNoFromBody(body: Contactable | null | undefined): string | undefined {
  if (!body) return undefined;
  return str(body.mobileNo) ?? str(body.phone);
}
