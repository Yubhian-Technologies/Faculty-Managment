// Supporting Staff CSV column definitions - used by the College Office
// bulk-import template/preview, mirroring src/lib/faculty/csvColumns.ts for
// the Faculty import. Designation is free text, per-college-type (see
// College.type and src/lib/designations/config.ts) - covers both the
// original Non-Technical roles and, for Engineering/Pharmacy/Dental
// colleges, the Technical roles migrated back in from the Faculty module.

export interface SupportingStaffCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  // Alternate header wordings that should still map to this column (see matchHeaders in csv.ts).
  aliases?: string[];
}

const PERSONAL_COLUMNS: SupportingStaffCsvColumn[] = [
  { key: "employeeId",        label: "Employee ID",                  required: true,  sample: "Required; any text; unique", aliases: ["Emp ID", "Employee Code", "Employee No", "Staff ID"] },
  { key: "name",               label: "Name",                         required: true,  sample: "Required; full name", aliases: ["Staff Name", "Full Name", "Employee Name"] },
  { key: "email",              label: "Personal Email",               required: false, sample: "Optional; must contain @ if provided", aliases: ["Email", "Email ID", "Personal Email ID"] },
  { key: "password",          label: "Login Password (min 8 characters, optional)", required: false, sample: "Optional; minimum 8 characters", aliases: ["Password", "Login Password"] },
  { key: "phone",              label: "Phone",                        required: false, sample: "Optional; phone/text", aliases: ["Mobile", "Mobile Number", "Phone Number", "Contact Number"] },
  { key: "designation",        label: "Designation",                  required: true,  sample: "Required; Office Staff / Accountant / Clerk / Attender / Office Assistant / Other" },
  { key: "otherDesignationTitle", label: "Designation Title (if Other)", required: false, sample: "Required only when Designation = Other; otherwise optional" },
  { key: "department",        label: "Department",                   required: false, sample: "Required; department name", aliases: ["Dept", "Department Code"] },
  { key: "employmentType",     label: "Employment Type",              required: false, sample: "Required: Permanent / Contract / Visiting / Part-Time", aliases: ["Employment", "Type of Employment"] },
  { key: "status",             label: "Status (Active/On Leave/Resigned/Retired)", required: false, sample: "Required: Active / On Leave / Resigned / Retired", aliases: ["Status"] },
  { key: "joiningDate",        label: "Joining Date (YYYY-MM-DD)",    required: true,  sample: "Required; YYYY-MM-DD", aliases: ["Joining Date", "Date of Joining", "DOJ"] },
  // Header reworded to say TOTAL: it means the whole career, not service at
  // this institution, which "Experience (Years)" beside a Joining Date column
  // read as. The old headers stay aliases so sheets already written against
  // them still import. Shared by both import pages - HOD's Supporting Staff
  // and College Office's Non-Technical Staff.
  { key: "experienceYears",    label: "Total Years of Experience", required: false, sample: "Optional; number", aliases: ["Experience (Years)", "Years of Experience", "Experience", "Total Experience"] },
  { key: "gender",            label: "Gender",                       required: false, sample: "Optional: Male / Female / Other" },
  { key: "dateOfBirth",       label: "Date of Birth (YYYY-MM-DD)",   required: false, sample: "Optional; YYYY-MM-DD" },
  { key: "legalName",         label: "Legal Name (as per SSC)",      required: false, sample: "Optional; text" },
  { key: "fatherName",        label: "Father / Husband Name",        required: false, sample: "Optional; text" },
  { key: "motherName",        label: "Mother Name",                  required: false, sample: "Optional; text" },
  { key: "aadharNo",          label: "Aadhar No",                    required: false, sample: "Optional; text" },
  { key: "panNo",             label: "PAN No",                       required: false, sample: "Optional; text" },
  { key: "passportNumber",    label: "Passport No",                  required: false, sample: "Optional; text" },
  { key: "emergencyContactName",  label: "Emergency Contact Name",   required: false, sample: "Optional; text" },
  { key: "emergencyContactPhone", label: "Emergency Contact Phone",  required: false, sample: "Optional; phone/text" },
  { key: "religion",          label: "Religion",                     required: false, sample: "Optional: Hindu / Muslim / Christian / Sikh / Jain / Parsi / Buddhist / Other" },
  { key: "caste",             label: "Caste",                        required: false, sample: "Optional: OC / EBC / EPC / BC / SC / ST / OTHER" },
  { key: "collegeEmail",      label: "College Email",                required: false, sample: "Required; must contain @" },
  { key: "ratificationStatus",label: "Ratification Status",          required: false, sample: "Optional: Ratified / Not Ratified" },
  { key: "ratificationDate",  label: "Ratification Date (YYYY-MM-DD)", required: false, sample: "Optional; YYYY-MM-DD" },
  { key: "maritalStatus",     label: "Marital Status (Single/Married)", required: false, sample: "Optional: Single / Married" },
  { key: "spouseName",        label: "Spouse Name",                  required: false, sample: "Optional; text" },
  { key: "numberOfChildren",  label: "Number of Children",           required: false, sample: "Optional; number (0,1,2...)" },
  { key: "referral",          label: "Referral (if any)",            required: false, sample: "Optional; text" },
  { key: "nativePlace",       label: "Native Place",                 required: false, sample: "Optional; text" },
  { key: "bloodGroup",        label: "Blood Group",                  required: false, sample: "Optional: A+ / A- / B+ / B- / AB+ / AB- / O+ / O-" },
  { key: "temporaryAddress",  label: "Temporary Address",            required: false, sample: "Optional; text" },
  { key: "permanentSameAsTemporary", label: "Permanent Same as Temporary (Yes/No)", required: false, sample: "Optional: Yes / No" },
  { key: "permanentAddress",  label: "Permanent Address",            required: false, sample: "Optional; text" },
];

// CSV import/export is intentionally limited to identity + personal/statutory
// details only (PERSONAL_COLUMNS) - the deeper profile modules (qualifications,
// responsibilities, computer skills, training, achievements, other info) are
// captured in the app's Add/Edit forms, not via spreadsheet.
/**
 * Which module is downloading the template. The two differ in exactly one
 * cell - the Designation column's guidance names a different set of titles -
 * so they share every other column rather than being maintained twice.
 * Defaults to "supporting" (HOD's Supporting Staff), the shape PERSONAL_COLUMNS
 * itself carries.
 */
export type StaffTemplateKind = "supporting" | "non-technical";

const NON_TECHNICAL_DESIGNATION_GUIDANCE =
  "Required; Lab Assistant / Programmer / System Administrator / Network Engineer / Other";

export function getSupportingStaffColumns(kind: StaffTemplateKind = "supporting"): SupportingStaffCsvColumn[] {
  if (kind === "supporting") return [...PERSONAL_COLUMNS];
  return PERSONAL_COLUMNS.map((c) =>
    c.key === "designation" ? { ...c, sample: NON_TECHNICAL_DESIGNATION_GUIDANCE } : c
  );
}

export function getSupportingStaffHints(): string[] {
  return [
    "Designation: any supporting-staff title used by your college (e.g. Office Staff, Accountant, Clerk, Attender, Office Assistant, Lab Assistant, Programmer, System Administrator, Network Engineer for Engineering/Pharmacy/Dental; AO, Librarian, Trainee etc. for Degree; A.A.O, Lab Technician etc. for Polytechnic; AO, Receptionist etc. for School) - use \"Other\" with a Designation Title if none of these fit",
    "Employment Type: Permanent, Contract, Visiting, Part-Time (defaults to Permanent if left blank or unrecognized)",
    "Status: Active, On Leave, Resigned, Retired (defaults to Active if left blank)",
    "Gender: Male, Female, Other",
    "Marital Status: Single, Married",
    "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
    "Total Years of Experience: the staff member's ENTIRE professional experience, including time served at previous institutions - not just their years at this college. For someone who worked 8 years elsewhere and 2 here, enter 10.",
    "Department is optional - leave blank for centrally-managed roles, or set it to assign this staff member to a specific department",
    "Department accepts either the full name (e.g. \"Computer Science\") or the short Code (e.g. \"CSE\") - it must already exist under Departments, otherwise it's ignored",
    "Login Password (optional): fill this in to create this staff member's login account automatically during import, using their College Email (or Personal Email if no College Email is given) as the login ID - must be at least 8 characters. Leave it blank to import the record without a login.",
    "All values are matched case-insensitively (e.g. \"male\", \"MALE\" and \"Male\" all work).",
  ];
}
