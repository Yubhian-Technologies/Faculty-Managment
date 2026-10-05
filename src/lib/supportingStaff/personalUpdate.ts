import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";

// The Personal Details a Supporting Staff record stores. Ratification and "differently abled" are Teaching-Faculty
// concepts the staff editor never shows (hiddenFields in SupportingStaffModuleEditor), so they are never written here.
const NOT_FOR_STAFF = new Set<string>([
  "ratificationStatus", "ratificationProceedingsNumber", "ratificationDate", "ratifications", "differentlyAbled", "differentlyAbledDetails",
]);

/**
 * The Firestore update for whichever Personal Details keys `body` carries - the full set the Add wizard stores
 * (buildPersonalDetailsUpdate), minus the faculty-only ones. Only keys that were sent appear, so it is safe in a
 * partial PATCH. The staff PATCH route used to hand-pick a shorter list, so Mother Tongue, Languages Known, Height,
 * Weight, PF / UAN / ESI Numbers were shown in the editor, accepted on create, and silently dropped on every edit.
 */
export function supportingStaffPersonalUpdate(body: PersonalDetailsInput): Record<string, unknown> {
  const updates = buildPersonalDetailsUpdate(body);
  for (const key of Object.keys(updates)) if (NOT_FOR_STAFF.has(key)) delete updates[key];
  return updates;
}

/**
 * Everything a Supporting Staff member may change about THEMSELVES (PATCH /api/college/supporting-staff/me).
 * Employee ID, College Email (their login), Designation, Department, Staff Category, Date of Joining, Status and
 * the linking uid belong to whoever manages the record (HOD / College Office / Library / Principal) and are never
 * accepted from the member - mirroring what Faculty may change about themselves (PATCH /api/college/faculty/me).
 */
export const SELF_EDITABLE_STAFF_FIELDS = [
  "legalName", "nameAsPerPan", "apaarFacultyId", "highestQualification", "email", "mobileNo", "additionalPhoneNumbers",
  "supportingStaffProfile", "profilePhotoUrl",
] as const;

export const SELF_LOCKED_STAFF_FIELDS = [
  "employeeId", "collegeEmail", "designation", "otherDesignationTitle", "department", "joiningDate", "status", "staffCategory",
  "employmentType", "userUid", "joiningLetterUrl", "appointmentLetterUrl", "totalYearsOfExperience",
] as const;
