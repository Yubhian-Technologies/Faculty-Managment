// Shared Supporting Staff CSV column definitions — used by the bulk-import
// template/preview (src/app/(dashboard)/{principal,hod}/supporting-staff/import/page.tsx),
// mirroring src/lib/faculty/csvColumns.ts for the Teaching Faculty import.

export interface SupportingStaffCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  // Alternate header wordings that should still map to this column (see matchHeaders in csv.ts).
  aliases?: string[];
}

export const COLUMNS: SupportingStaffCsvColumn[] = [
  { key: "employeeId",        label: "Employee ID",                  required: true,  sample: "STF001", aliases: ["Emp ID", "Employee Code", "Employee No", "Staff ID"] },
  { key: "name",               label: "Name",                         required: true,  sample: "Ramesh Kumar", aliases: ["Staff Name", "Full Name", "Employee Name"] },
  { key: "email",              label: "Personal Email",               required: false, sample: "ramesh@gmail.com", aliases: ["Email", "Email ID", "Personal Email ID"] },
  { key: "phone",              label: "Phone",                        required: false, sample: "9876543210", aliases: ["Mobile", "Mobile Number", "Phone Number", "Contact Number"] },
  { key: "staffCategory",      label: "Staff Category (Technical/Non-Technical)", required: false, sample: "Technical", aliases: ["Category", "Staff Type"] },
  { key: "designation",        label: "Designation",                  required: false, sample: "Lab Assistant" },
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
  { key: "otherInformation",  label: "Other Information",            required: false, sample: "" },
];

export const HINTS = [
  "Staff Category: Technical, Non-Technical (defaults to Non-Technical if left blank or unrecognized)",
  "Technical Designation: Lab Assistant, Programmer, System Administrator, Network Engineer, Other",
  "Non-Technical Designation: Office Staff, Accountant, Librarian, Clerk, Attender, Office Assistant, Other (defaults to Other if left blank or unrecognized)",
  "Employment Type: Permanent, Contract, Visiting, Part-Time (defaults to Permanent if left blank or unrecognized)",
  "Status: Active, On Leave, Resigned, Retired (defaults to Active if left blank)",
  "Gender: Male, Female, Other",
  "Marital Status: Single, Married",
  "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
  "Department is optional — leave blank for centrally-managed roles (Librarian, Accountant, etc.) or for it to default to your own department",
  "Department accepts either the full name (e.g. \"Computer Science\") or the short Code (e.g. \"CSE\") — it must already exist under Departments, otherwise it's ignored (falls back to your own department if you're an HOD, or blank otherwise)",
  "Imported records aren't given login access — use \"Add Staff\" instead for staff members who need to log in",
];
