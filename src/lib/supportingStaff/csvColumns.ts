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
  { key: "employeeId",        label: "Employee ID",                  required: true,  sample: "STF001", aliases: ["Emp ID", "Employee Code", "Employee No", "Staff ID"] },
  { key: "name",               label: "Name",                         required: true,  sample: "Ramesh Kumar", aliases: ["Staff Name", "Full Name", "Employee Name"] },
  { key: "email",              label: "Personal Email",               required: false, sample: "ramesh@gmail.com", aliases: ["Email", "Email ID", "Personal Email ID"] },
  { key: "password",          label: "Login Password (min 8 characters, optional)", required: false, sample: "", aliases: ["Password", "Login Password"] },
  { key: "phone",              label: "Phone",                        required: false, sample: "9876543210", aliases: ["Mobile", "Mobile Number", "Phone Number", "Contact Number"] },
  { key: "designation",        label: "Designation",                  required: true,  sample: "Office Staff" },
  { key: "otherDesignationTitle", label: "Designation Title (if Other)", required: false, sample: "" },
  { key: "department",        label: "Department",                   required: false, sample: "CSE", aliases: ["Dept", "Department Code"] },
  { key: "employmentType",     label: "Employment Type",              required: false, sample: "Permanent", aliases: ["Employment", "Type of Employment"] },
  { key: "status",             label: "Status (Active/On Leave/Resigned/Retired)", required: false, sample: "Active", aliases: ["Status"] },
  { key: "joiningDate",        label: "Joining Date (YYYY-MM-DD)",    required: true,  sample: "2020-06-01", aliases: ["Joining Date", "Date of Joining", "DOJ"] },
  { key: "experienceYears",    label: "Experience (Years)",           required: false, sample: "5" },
  { key: "gender",            label: "Gender",                       required: false, sample: "Male" },
  { key: "dateOfBirth",       label: "Date of Birth (YYYY-MM-DD)",   required: false, sample: "1990-05-15" },
  { key: "legalName",         label: "Legal Name (as per SSC)",      required: false, sample: "RAMESH KUMAR" },
  { key: "fatherName",        label: "Father / Husband Name",        required: false, sample: "" },
  { key: "motherName",        label: "Mother Name",                  required: false, sample: "" },
  { key: "aadharNo",          label: "Aadhar No",                    required: false, sample: "" },
  { key: "panNo",             label: "PAN No",                       required: false, sample: "" },
  { key: "passportNumber",    label: "Passport No",                  required: false, sample: "" },
  { key: "emergencyContactName",  label: "Emergency Contact Name",   required: false, sample: "" },
  { key: "emergencyContactPhone", label: "Emergency Contact Phone",  required: false, sample: "" },
  { key: "religion",          label: "Religion",                     required: false, sample: "" },
  { key: "caste",             label: "Caste",                        required: false, sample: "" },
  { key: "collegeEmail",      label: "College Email",                required: false, sample: "" },
  { key: "ratificationStatus",label: "Ratification Status",          required: false, sample: "" },
  { key: "ratificationDate",  label: "Ratification Date (YYYY-MM-DD)", required: false, sample: "" },
  { key: "maritalStatus",     label: "Marital Status (Single/Married)", required: false, sample: "" },
  { key: "spouseName",        label: "Spouse Name",                  required: false, sample: "" },
  { key: "numberOfChildren",  label: "Number of Children",           required: false, sample: "" },
  { key: "referral",          label: "Referral (if any)",            required: false, sample: "" },
  { key: "nativePlace",       label: "Native Place",                 required: false, sample: "" },
  { key: "bloodGroup",        label: "Blood Group",                  required: false, sample: "" },
  { key: "temporaryAddress",  label: "Temporary Address",            required: false, sample: "" },
  { key: "permanentSameAsTemporary", label: "Permanent Same as Temporary (Yes/No)", required: false, sample: "" },
  { key: "permanentAddress",  label: "Permanent Address",            required: false, sample: "" },
];

// CSV import/export is intentionally limited to identity + personal/statutory
// details only (PERSONAL_COLUMNS) - the deeper profile modules (qualifications,
// responsibilities, computer skills, training, achievements, other info) are
// captured in the app's Add/Edit forms, not via spreadsheet.
export function getSupportingStaffColumns(): SupportingStaffCsvColumn[] {
  return [...PERSONAL_COLUMNS];
}

export function getSupportingStaffHints(): string[] {
  return [
    "Designation: any supporting-staff title used by your college (e.g. Office Staff, Accountant, Clerk, Attender, Office Assistant, Lab Assistant, Programmer, System Administrator, Network Engineer for Engineering/Pharmacy/Dental; AO, Librarian, Trainee etc. for Degree; A.A.O, Lab Technician etc. for Polytechnic; AO, Receptionist etc. for School) - use \"Other\" with a Designation Title if none of these fit",
    "Employment Type: Permanent, Contract, Visiting, Part-Time (defaults to Permanent if left blank or unrecognized)",
    "Status: Active, On Leave, Resigned, Retired (defaults to Active if left blank)",
    "Gender: Male, Female, Other",
    "Marital Status: Single, Married",
    "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
    "Department is optional - leave blank for centrally-managed roles, or set it to assign this staff member to a specific department",
    "Department accepts either the full name (e.g. \"Computer Science\") or the short Code (e.g. \"CSE\") - it must already exist under Departments, otherwise it's ignored",
    "Login Password (optional): fill this in to create this staff member's login account automatically during import, using their College Email (or Personal Email if no College Email is given) as the login ID - must be at least 8 characters. Leave it blank to import the record without a login.",
    "All values are matched case-insensitively (e.g. \"male\", \"MALE\" and \"Male\" all work).",
  ];
}
