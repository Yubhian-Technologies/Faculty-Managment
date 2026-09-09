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

// The import is intentionally limited to exactly these 16 columns - every one
// mandatory except Name (as per PAN) and Name (as per Aadhar), which are
// optional. No other optional structural extras (Personal Email, Designation
// Title, Department, Status, Total Years of Experience are no longer
// collected via import; add/edit them afterward in the app if needed).
// Designation "Other" therefore isn't usable via import either - see the
// import route, which rejects it with a message pointing at manual Add
// Staff instead. Otherwise mirrors Faculty's trimmed IMPORT_COLUMNS
// (src/lib/faculty/csvColumns.ts) field for field, including the
// two-name-fields ordering (SSC name, then PAN name).
const PERSONAL_COLUMNS: SupportingStaffCsvColumn[] = [
  { key: "employeeId",        label: "Employee ID",                  required: true,  sample: "Required; any text; unique", aliases: ["Emp ID", "Employee Code", "Employee No", "Staff ID"] },
  { key: "legalName",         label: "Full Name (as per SSC)",       required: true,  sample: "Required; text", aliases: ["Legal Name (as per SSC)"] },
  // "Full Name" (bare) is deliberately NOT aliased here - it would be
  // genuinely ambiguous now that there are two other name-shaped columns
  // (Full Name as per SSC, Name as per Aadhar); leave a header that vague
  // unmatched rather than guess which one it means.
  { key: "name",               label: "Name (as per PAN)",           required: false, sample: "Optional; full name", aliases: ["Staff Name", "Employee Name"] },
  { key: "collegeEmail",      label: "College Email",                required: true,  sample: "Required; must contain @" },
  { key: "password",          label: "Login Password (min 8 characters)", required: true, sample: "Required; minimum 8 characters", aliases: ["Password", "Login Password"] },
  { key: "phone",              label: "Mobile No",                   required: true,  sample: "Required; phone/text", aliases: ["Phone", "Mobile", "Mobile Number", "Phone Number", "Contact Number"] },
  { key: "designation",        label: "Designation",                 required: true,  sample: "Required; Lab Assistant / Programmer / System Administrator / Network Engineer" },
  { key: "qualification",     label: "Highest Qualification",        required: true,  sample: "Required; free text", aliases: ["Qualification"] },
  { key: "employmentType",     label: "Employee Category",           required: true,  sample: "Required: Regular / Contract / Voucher", aliases: ["Employment Type", "Employment", "Type of Employment"] },
  { key: "joiningDate",        label: "Date of Joining Institution (YYYY-MM-DD)", required: true, sample: "Required; YYYY-MM-DD", aliases: ["Joining Date", "Date of Joining", "DOJ"] },
  { key: "gender",            label: "Gender",                       required: true,  sample: "Required: Male / Female / Other" },
  { key: "dateOfBirth",       label: "Date of Birth (YYYY-MM-DD)",   required: true,  sample: "Required; YYYY-MM-DD" },
  { key: "nameAsPerAadhar",   label: "Name (as per Aadhar)",         required: false, sample: "Optional; text" },
  { key: "aadharNo",          label: "Aadhar No",                    required: true,  sample: "Required; text" },
  { key: "panNo",             label: "PAN No",                       required: true,  sample: "Required; text" },
  { key: "ratificationStatus",label: "Ratification Status",          required: true,  sample: "Required: Ratified / Not Ratified" },
];

// CSV import/export is intentionally limited to identity + personal/statutory
// details only (PERSONAL_COLUMNS) - the deeper profile modules (qualifications,
// responsibilities, computer skills, training, achievements, other info) are
// captured in the app's Add/Edit forms, not via spreadsheet.
/**
 * Which module is downloading the template. The two differ in exactly one cell
 * - the Designation column - because their Add forms offer different title
 * sets: HOD's Supporting Staff uses getHodTechnicalDesignations (Lab Assistant,
 * Programmer, System Administrator, Network Engineer), while College Office's
 * Non-Technical Staff uses getNonTechnicalDesignations, which is the full
 * supporting list with that Technical subset removed. Every other column is
 * shared rather than maintained twice.
 */
export type StaffTemplateKind = "supporting" | "non-technical";

const NON_TECHNICAL_DESIGNATION_GUIDANCE =
  "Required; Office Staff / Accountant / Clerk / Attender / Office Assistant";

export function getSupportingStaffColumns(kind: StaffTemplateKind = "supporting"): SupportingStaffCsvColumn[] {
  if (kind === "supporting") return [...PERSONAL_COLUMNS];
  return PERSONAL_COLUMNS.map((c) =>
    c.key === "designation" ? { ...c, sample: NON_TECHNICAL_DESIGNATION_GUIDANCE } : c
  );
}

// Five filled-in rows for the template workbook's second sheet - what a
// correctly-completed row looks like for every column, which the guidance row
// on sheet one can only describe. Keyed by column key rather than written as a
// positional array so adding or reordering a column can't silently shift the
// data under the wrong headers.
//
// Designation is filled in below from SAMPLE_DESIGNATIONS_BY_KIND so the samples
// always use titles that kind's own guidance row actually lists.
//
// Login Password now gets a real, distinct-per-row sample value since the
// column is mandatory (every row creates a real login on import) - each one
// MUST be changed to something unique before real use; see the hints below.
// Never reuse these literal strings for a real account.
const SAMPLE_DESIGNATIONS_BY_KIND: Record<StaffTemplateKind, string[]> = {
  supporting: ["Lab Assistant", "Programmer", "System Administrator", "Network Engineer"],
  "non-technical": ["Office Staff", "Accountant", "Clerk", "Attender"],
};

const SAMPLE_ROWS_BASE: Record<string, string>[] = [
  {
    employeeId: "STF001", legalName: "RAVI TEJA", name: "Ravi Teja",
    collegeEmail: "ravi.teja@college.edu", password: "ChangeMe#201", phone: "9876543210",
    qualification: "Diploma",
    employmentType: "Regular", joiningDate: "2018-06-11",
    gender: "Male", dateOfBirth: "1988-04-17",
    nameAsPerAadhar: "Ravi Teja",
    aadharNo: "123456789012", panNo: "ABCDE1234F",
    ratificationStatus: "Ratified",
  },
  {
    employeeId: "STF002", legalName: "LAKSHMI PRASANNA", name: "Lakshmi Prasanna",
    collegeEmail: "lakshmi.p@college.edu", password: "ChangeMe#202", phone: "9876543211",
    qualification: "B.Com",
    employmentType: "Contract", joiningDate: "2021-09-01",
    gender: "Female", dateOfBirth: "1993-12-02",
    nameAsPerAadhar: "Lakshmi Prasanna",
    aadharNo: "234567890123", panNo: "BCDEF2345G",
    ratificationStatus: "Not Ratified",
  },
  {
    employeeId: "STF003", legalName: "MOHAMMED RAFI", name: "Mohammed Rafi",
    collegeEmail: "rafi.m@college.edu", password: "ChangeMe#203", phone: "9876543212",
    qualification: "ITI",
    employmentType: "Voucher", joiningDate: "2015-02-20",
    gender: "Male", dateOfBirth: "1983-08-25",
    nameAsPerAadhar: "Mohammed Rafi",
    aadharNo: "345678901234", panNo: "CDEFG3456H",
    ratificationStatus: "Ratified",
  },
  {
    employeeId: "STF004", legalName: "SUNITHA RANI", name: "Sunitha Rani",
    collegeEmail: "sunitha.rani@college.edu", password: "ChangeMe#204", phone: "9876543213",
    qualification: "B.Sc",
    employmentType: "Regular", joiningDate: "2023-07-03",
    gender: "Female", dateOfBirth: "1997-05-11",
    nameAsPerAadhar: "Sunitha Rani",
    aadharNo: "456789012345", panNo: "DEFGH4567I",
    ratificationStatus: "Not Ratified",
  },
  {
    employeeId: "STF005", legalName: "VENKAT RAO", name: "Venkat Rao",
    collegeEmail: "venkat.rao@college.edu", password: "ChangeMe#205", phone: "9876543214",
    qualification: "SSC",
    employmentType: "Contract", joiningDate: "2011-11-28",
    gender: "Male", dateOfBirth: "1976-01-09",
    nameAsPerAadhar: "Venkat Rao",
    aadharNo: "567890123456", panNo: "EFGHI5678J",
    ratificationStatus: "Ratified",
  },
];

/**
 * The five sample rows, one per real designation title in that kind's
 * catalogue (cycling once the 5th row exceeds it) - every row is a complete,
 * importable record with no conditional fields left to demonstrate.
 */
export function getSupportingStaffSampleRows(kind: StaffTemplateKind = "supporting"): Record<string, string>[] {
  const titles = SAMPLE_DESIGNATIONS_BY_KIND[kind];
  return SAMPLE_ROWS_BASE.map((row, i) => ({
    ...row,
    designation: titles[i % titles.length],
  }));
}

export function getSupportingStaffHints(): string[] {
  return [
    "Full Name (as per SSC): enter the name exactly as it appears on the staff member's SSC (10th class) certificate, in CAPITAL LETTERS",
    "Name (as per PAN) and Name (as per Aadhar) are optional - enter them exactly as they appear on those documents if available; Name (as per PAN) is also used as their display name across the app until it's filled in",
    "Designation: any supporting-staff title used by your college (e.g. Office Staff, Accountant, Clerk, Attender, Office Assistant, Lab Assistant, Programmer, System Administrator, Network Engineer for Engineering/Pharmacy/Dental; AO, Librarian, Trainee etc. for Degree; A.A.O, Lab Technician etc. for Polytechnic; AO, Receptionist etc. for School) - \"Other\" isn't supported for bulk import; add that staff member individually via Add Staff instead",
    "Employee Category: Regular, Contract, Voucher",
    "Gender: Male, Female, Other",
    "Ratification Status: Ratified, Not Ratified",
    "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
    "Login Password is mandatory: it creates this staff member's login account automatically during import, using their College Email as the login ID - must be at least 8 characters. Use a real, unique password per person - never reuse the sample column's placeholder values.",
    "Every column in the template is required except Name (as per PAN) and Name (as per Aadhar) - a row missing a required column, or with an invalid value, is rejected and reported back so it can be corrected and re-imported.",
    "Personal Email, Department, Status, and Total Years of Experience are not collected by import - add them afterward from the staff member's own Edit page if needed.",
    "All values are matched case-insensitively (e.g. \"male\", \"MALE\" and \"Male\" all work).",
  ];
}
