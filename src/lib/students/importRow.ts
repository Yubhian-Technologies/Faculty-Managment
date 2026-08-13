// Shared student-roster row validation/mapping, used by both the single-section
// JSON import (college/students/import) and the multi-section bulk roster
// upload (college/students/import-excel) so the roll-number/status rules and
// document shape stay in exactly one place.

import type { Section, StudentStatus } from "@/types";

export interface StudentImportRow {
  rollNumber: string;
  name: string;
  status?: string;
  gender?: string;
  dateOfBirth?: string;
  guardianContact?: string;
  email?: string;
  // View-only department (e.g. a 1st-year's registered core branch while
  // primarily enrolled under Basic Science) - only meaningfully populated by
  // the multi-department bulk import (students/import-excel); validated
  // there against real department names before reaching this helper.
  secondaryDepartment?: string;
  // ─── Admission-detail fields ────────────────────────────────────────────
  // All optional; see the matching fields on StudentRecord (src/types/core.ts)
  // for what each one means. "Branch" in the source sheet is still an alias of
  // the department column; "Course" is its own column now (the roster template
  // carries both) and is recorded verbatim. Photo is not collected via CSV.
  course?: string;
  semester?: string;
  dateOfAdmission?: string;
  admissionNo?: string;
  hallTicketNo?: string;
  admissionType?: string;
  entranceType?: string;
  entranceRank?: string;
  seatType?: string;
  scholarship?: string;
  category?: string;
  religion?: string;
  nationality?: string;
  motherTongue?: string;
  bloodGroup?: string;
  mobileNo?: string;
  landLineNo?: string;
  aadharNo?: string;
  rationCardNo?: string;
  bankAccountNo?: string;
  lastAttendedInstitution?: string;
  distanceFromResidenceKm?: string;
  hosteller?: string;
  physicallyHandicapped?: string;
  handicappedType?: string;
  identificationMarks?: string;
  remarks?: string;
}

export function parseStudentStatus(v: string | undefined): StudentStatus {
  return v?.trim().toUpperCase().startsWith("DET") ? "DETAINED" : "REGULAR";
}

// "Yes"/"No" (any case, or "Y"/"N") radio-button columns - undefined (not
// "false") when the cell is blank, so an omitted column doesn't overwrite a
// value set some other way.
function parseYesNo(v: string | undefined): boolean | undefined {
  const t = v?.trim().toUpperCase();
  if (!t) return undefined;
  if (t === "YES" || t === "Y" || t === "TRUE") return true;
  if (t === "NO" || t === "N" || t === "FALSE") return false;
  return undefined;
}

// Distance is the only free-form numeric field that's meaningfully
// fractional (e.g. "5.5" km) - kept separate from parseSemester, which only
// ever wants the leading whole number out of a label like "1st Semester".
function parseNumberOrUndefined(v: string | undefined): number | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// "1st Semester", "Semester 1", "1" all reduce to the same stored value.
function parseSemester(v: string | undefined): number | undefined {
  const m = v?.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

function parseHandicappedType(v: string | undefined): "H" | "V" | "O" | undefined {
  const t = v?.trim().toUpperCase();
  return t === "H" || t === "V" || t === "O" ? t : undefined;
}

export function buildStudentDoc(
  section: Pick<Section, "collegeId" | "department" | "name" | "year">,
  row: StudentImportRow,
  now: Date
): Record<string, unknown> {
  return {
    collegeId: section.collegeId,
    department: section.department,
    section: section.name,
    year: section.year,
    rollNumber: row.rollNumber.trim(),
    name: row.name.trim(),
    status: parseStudentStatus(row.status),
    ...(row.gender?.trim() ? { gender: row.gender.trim() } : {}),
    ...(row.dateOfBirth?.trim() ? { dateOfBirth: row.dateOfBirth.trim() } : {}),
    ...(row.guardianContact?.trim() ? { guardianContact: row.guardianContact.trim() } : {}),
    ...(row.email?.trim() ? { email: row.email.trim().toLowerCase() } : {}),
    ...(row.secondaryDepartment?.trim() ? { secondaryDepartment: row.secondaryDepartment.trim() } : {}),
    ...(row.course?.trim() ? { course: row.course.trim() } : {}),
    ...(parseSemester(row.semester) !== undefined ? { semester: parseSemester(row.semester) } : {}),
    ...(row.dateOfAdmission?.trim() ? { dateOfAdmission: row.dateOfAdmission.trim() } : {}),
    ...(row.admissionNo?.trim() ? { admissionNo: row.admissionNo.trim() } : {}),
    ...(row.hallTicketNo?.trim() ? { hallTicketNo: row.hallTicketNo.trim() } : {}),
    ...(row.admissionType?.trim() ? { admissionType: row.admissionType.trim() } : {}),
    ...(row.entranceType?.trim() ? { entranceType: row.entranceType.trim() } : {}),
    ...(row.entranceRank?.trim() ? { entranceRank: row.entranceRank.trim() } : {}),
    ...(row.seatType?.trim() ? { seatType: row.seatType.trim() } : {}),
    ...(parseYesNo(row.scholarship) !== undefined ? { scholarship: parseYesNo(row.scholarship) } : {}),
    ...(row.category?.trim() ? { category: row.category.trim() } : {}),
    ...(row.religion?.trim() ? { religion: row.religion.trim() } : {}),
    ...(row.nationality?.trim() ? { nationality: row.nationality.trim() } : {}),
    ...(row.motherTongue?.trim() ? { motherTongue: row.motherTongue.trim() } : {}),
    ...(row.bloodGroup?.trim() ? { bloodGroup: row.bloodGroup.trim() } : {}),
    ...(row.mobileNo?.trim() ? { mobileNo: row.mobileNo.trim() } : {}),
    ...(row.landLineNo?.trim() ? { landLineNo: row.landLineNo.trim() } : {}),
    ...(row.aadharNo?.trim() ? { aadharNo: row.aadharNo.trim() } : {}),
    ...(row.rationCardNo?.trim() ? { rationCardNo: row.rationCardNo.trim() } : {}),
    ...(row.bankAccountNo?.trim() ? { bankAccountNo: row.bankAccountNo.trim() } : {}),
    ...(row.lastAttendedInstitution?.trim() ? { lastAttendedInstitution: row.lastAttendedInstitution.trim() } : {}),
    ...(parseNumberOrUndefined(row.distanceFromResidenceKm) !== undefined ? { distanceFromResidenceKm: parseNumberOrUndefined(row.distanceFromResidenceKm) } : {}),
    ...(parseYesNo(row.hosteller) !== undefined ? { hosteller: parseYesNo(row.hosteller) } : {}),
    ...(parseYesNo(row.physicallyHandicapped) !== undefined ? { physicallyHandicapped: parseYesNo(row.physicallyHandicapped) } : {}),
    ...(parseHandicappedType(row.handicappedType) ? { handicappedType: parseHandicappedType(row.handicappedType) } : {}),
    ...(row.identificationMarks?.trim() ? { identificationMarks: row.identificationMarks.trim() } : {}),
    ...(row.remarks?.trim() ? { remarks: row.remarks.trim() } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
