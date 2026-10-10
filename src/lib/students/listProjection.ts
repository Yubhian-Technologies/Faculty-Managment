// What a student LIST response may carry, by role.
//
// GET /api/college/students used to return whole student documents to every role
// that can call it - including Aadhaar and ration-card numbers, bank account
// details, caste and religion - to a Library clerk filling a dropdown, to every
// faculty member in charge of a section, and to an HOD whose own list shows a
// roll number and a name. Lists now carry only what the role's screens use:
//
//  - the office tier (College Office, Principal, Vice Principal, Super Admin)
//    keeps the full record - they own admission data and the Edit form needs it;
//  - HOD and faculty (PANEL_MEMBER) keep everything their roster, section and
//    lab-batch screens read (contact details included) but lose the national-ID,
//    bank, caste/religion, disability and admission-score fields;
//  - Library gets an identity-only record (enough to pick a student).
//
// A single student's own page (GET /students/[id]) is deliberately unchanged:
// that is a deliberate "open this record" and keeps its own scope check.

export const FULL_RECORD_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"] as const;

/** Removed from list rows for HOD and faculty. */
export const REDACTED_FOR_DEPARTMENT_ROLES = [
  "aadharNo",
  "rationCardNo",
  "bankAccountNo",
  "bankName",
  "ifscCode",
  "caste",
  "subCaste",
  "religion",
  "scholarship",
  "jeeRank",
  "jeePercentage",
  "entranceType",
  "entranceRank",
  "physicallyHandicapped",
  "handicappedType",
  "identificationMarks",
  "studiedOutsideAP",
  "studiedOutsideAPDetails",
  "familyIdLinkedOtherState",
  "familyIdLinkedOtherStateDetails",
  "parentsWorkingOutside",
  "parentsWorkingOutsideDetails",
] as const;

/** The only fields a Library list row keeps. */
export const LIBRARY_LIST_FIELDS = [
  "id",
  "name",
  "rollNumber",
  "department",
  "secondaryDepartment",
  "year",
  "section",
  "status",
  "course",
  "courseId",
  "accessLevel",
] as const;

type Row = Record<string, unknown>;

export function projectStudentForRole<T extends object>(role: string, student: T): Partial<T> {
  if ((FULL_RECORD_ROLES as readonly string[]).includes(role)) return student;
  const source = student as Row;
  if (role === "LIBRARY") {
    const out: Row = {};
    for (const key of LIBRARY_LIST_FIELDS) if (key in source) out[key] = source[key];
    return out as Partial<T>;
  }
  // HOD, PANEL_MEMBER and anything else: drop the sensitive identifiers.
  const out: Row = { ...source };
  for (const key of REDACTED_FOR_DEPARTMENT_ROLES) delete out[key];
  return out as Partial<T>;
}

export function projectStudentsForRole<T extends object>(role: string, students: T[]): Partial<T>[] {
  if ((FULL_RECORD_ROLES as readonly string[]).includes(role)) return students;
  return students.map((s) => projectStudentForRole(role, s));
}
