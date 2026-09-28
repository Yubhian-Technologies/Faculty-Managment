// Supporting Staff CSV export - the counterpart to the bulk-import template
// (src/lib/supportingStaff/csvColumns.ts). Not round-trippable back through
// import: it also carries Department, Status, Staff Category and Total Years
// of Experience, which the import template deliberately excludes (those are
// "add them afterward from the staff member's own Edit page" fields - see
// getSupportingStaffHints) but which ARE real, current state on every
// existing record and belong in a "download the roster" export. Login
// Password is never exported - it isn't stored anywhere after account
// creation, and wouldn't belong in an export even if it were.
//
// Deliberately simpler than exportFacultyCsv.ts's field-picker dialog: a
// Supporting Staff record has nothing resembling Faculty's academicProfile
// module depth (qualifications/training/achievements live in
// supportingStaffProfile, but aren't part of this identity/employment
// export), so a fixed column set needs no per-field selection UI.

import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { toDateInputValue } from "@/lib/utils";
import { STAFF_CATEGORY_LABELS, NON_TECHNICAL_STAFF_DESIGNATION_LABELS } from "@/types/supportingStaff";
import { FACULTY_STATUS_LABELS } from "@/types/core";
import type { SupportingStaffMember, SupportingStaffDesignation } from "@/types";

// Same designation-label resolution the list pages already render in their
// own "Role" column (HodSupportingStaffPage / CollegeOfficeNonTechnicalStaffPage) -
// kept local rather than importing lib/designations/config.ts's broader
// designationLabel() so the exported CSV always shows the exact same label a
// viewer already saw on screen, not a different (if equivalent) resolution.
function designationLabel(designation: SupportingStaffDesignation): string {
  return (NON_TECHNICAL_STAFF_DESIGNATION_LABELS as Record<string, string>)[designation] ?? designation;
}

function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

const EXPORT_COLUMNS: { key: string; label: string }[] = [
  { key: "employeeId", label: "Employee ID" },
  { key: "legalName", label: "Full Name (as per SSC)" },
  { key: "nameAsPerPan", label: "Name (as per PAN)" },
  { key: "nameAsPerAadhar", label: "Name (as per Aadhar)" },
  { key: "staffCategory", label: "Staff Category" },
  { key: "designation", label: "Designation" },
  { key: "department", label: "Department" },
  { key: "status", label: "Status" },
  { key: "collegeEmail", label: "College Email" },
  { key: "email", label: "Personal Email" },
  { key: "mobileNo", label: "Mobile No" },
  { key: "highestQualification", label: "Highest Qualification" },
  { key: "joiningDate", label: "Date of Joining Institution" },
  { key: "totalYearsOfExperience", label: "Total Years of Experience" },
  { key: "gender", label: "Gender" },
  { key: "dateOfBirth", label: "Date of Birth" },
  { key: "aadharNo", label: "Aadhar No" },
  { key: "panNo", label: "PAN No" },
];

// `staff` is expected already-migrated (the GET /api/college/supporting-staff
// route runs every doc through migrateSupportingStaffDoc before returning it -
// see its own GET handler), same as what both list pages already hold in
// state, so this doesn't re-run that migration itself.
function buildRow(staff: SupportingStaffMember): Record<string, string> {
  return {
    employeeId: s(staff.employeeId),
    legalName: s(staff.legalName),
    nameAsPerPan: s(staff.nameAsPerPan),
    nameAsPerAadhar: s(staff.nameAsPerAadhar),
    staffCategory: staff.staffCategory ? (STAFF_CATEGORY_LABELS[staff.staffCategory] ?? s(staff.staffCategory)) : "",
    designation: staff.designation === "OTHER" && staff.otherDesignationTitle
      ? staff.otherDesignationTitle
      : designationLabel(staff.designation),
    department: s(staff.department) || "Centrally managed",
    status: staff.status ? (FACULTY_STATUS_LABELS[staff.status] ?? s(staff.status)) : "",
    collegeEmail: s(staff.collegeEmail),
    email: s(staff.email),
    mobileNo: s(staff.mobileNo),
    highestQualification: s(staff.highestQualification),
    joiningDate: toDateInputValue(staff.joiningDate),
    totalYearsOfExperience: s(staff.totalYearsOfExperience),
    gender: s(staff.gender),
    dateOfBirth: toDateInputValue(staff.dateOfBirth),
    aadharNo: s(staff.aadharNo),
    panNo: s(staff.panNo),
  };
}

/**
 * Downloads a CSV of every given staff record - always the full column set
 * above (no per-field picker; see this file's own top comment for why).
 * `filenamePrefix` is "supporting_staff" (HOD's Technical roster) or
 * "non_technical_staff" (College Office's), matching each page's own naming.
 */
export function exportSupportingStaffCsv(staff: SupportingStaffMember[], filenamePrefix: string): void {
  const headers = EXPORT_COLUMNS.map((c) => c.label);
  const rows = staff.map((member) => {
    const row = buildRow(member);
    return EXPORT_COLUMNS.map((c) => row[c.key] ?? "");
  });
  downloadCSV(toCSV([headers, ...rows]), `${filenamePrefix}_export_${toDateInputValue(new Date())}.csv`);
}
