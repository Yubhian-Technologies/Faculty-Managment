// Supporting Staff (Non-Technical) CSV column definitions - used by the
// College Office bulk-import template/preview, mirroring
// src/lib/faculty/csvColumns.ts for the Faculty import. Technical staff moved
// to the Faculty module (see TECHNICAL_STAFF_DESIGNATIONS in core.ts) - this
// module only ever covers Non-Technical staff now, so there's no per-category
// composition here anymore.

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
  { key: "designation",        label: "Designation",                  required: false, sample: "Office Staff" },
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

// Qualifications, Training and Achievements are shared *structures*
// (StaffQualification[] / TrainingEntry[] / AwardEntry[]).
const QUALIFICATION_COLUMNS: SupportingStaffCsvColumn[] = [1, 2].flatMap((n) => [
  { key: `qualification${n}_level`,          label: `Qualification ${n} - Level`,          required: false, sample: n === 1 ? "SSC" : "" } satisfies SupportingStaffCsvColumn,
  { key: `qualification${n}_degreeAndBranch`, label: `Qualification ${n} - Degree & Branch`, required: false, sample: "" },
  { key: `qualification${n}_university`,      label: `Qualification ${n} - University/Board`, required: false, sample: "" },
  { key: `qualification${n}_percentage`,      label: `Qualification ${n} - Percentage/Division`, required: false, sample: "" },
  { key: `qualification${n}_year`,            label: `Qualification ${n} - Year of Completion`, required: false, sample: "" },
]);

const TRAINING_COLUMNS: SupportingStaffCsvColumn[] = [1, 2].flatMap((n) => [
  { key: `training${n}_type`,      label: `Training ${n} - Type`,      required: false, sample: n === 1 ? "FDP" : "" } satisfies SupportingStaffCsvColumn,
  { key: `training${n}_title`,     label: `Training ${n} - Title`,     required: false, sample: "" },
  { key: `training${n}_organizer`, label: `Training ${n} - Organizer`, required: false, sample: "" },
  { key: `training${n}_year`,      label: `Training ${n} - Year`,      required: false, sample: "" },
]);

const ACHIEVEMENT_COLUMNS: SupportingStaffCsvColumn[] = [1, 2].flatMap((n) => [
  { key: `achievement${n}_category`,     label: `Achievement ${n} - Category`,     required: false, sample: "" } satisfies SupportingStaffCsvColumn,
  { key: `achievement${n}_title`,        label: `Achievement ${n} - Title`,        required: false, sample: "" },
  { key: `achievement${n}_awardingBody`, label: `Achievement ${n} - Awarding Body`, required: false, sample: "" },
  { key: `achievement${n}_year`,         label: `Achievement ${n} - Year`,         required: false, sample: "" },
]);

const NON_TECHNICAL_COLUMNS: SupportingStaffCsvColumn[] = [
  { key: "responsibilities",    label: "Responsibilities (comma-separated)",    required: false, sample: "Office Administration, Documentation" },
  { key: "otherResponsibility", label: "Other Responsibility (if Other selected)", required: false, sample: "" },
  { key: "computerSkills",      label: "Computer Skills (comma-separated)",     required: false, sample: "MS Office, Excel" },
  { key: "otherComputerSkill",  label: "Other Computer Skill (if Other selected)", required: false, sample: "" },
  { key: "typingSpeedWpm",      label: "Typing Speed (WPM)",                    required: false, sample: "" },
];

const OTHER_INFO_COLUMN: SupportingStaffCsvColumn = { key: "otherInformation", label: "Other Information", required: false, sample: "" };

export function getSupportingStaffColumns(): SupportingStaffCsvColumn[] {
  return [
    ...PERSONAL_COLUMNS,
    ...QUALIFICATION_COLUMNS,
    ...NON_TECHNICAL_COLUMNS,
    ...TRAINING_COLUMNS,
    ...ACHIEVEMENT_COLUMNS,
    OTHER_INFO_COLUMN,
  ];
}

export function getSupportingStaffHints(): string[] {
  return [
    "Designation: Office Staff, Accountant, Librarian, Clerk, Attender, Office Assistant, Other",
    "Employment Type: Permanent, Contract, Visiting, Part-Time (defaults to Permanent if left blank or unrecognized)",
    "Status: Active, On Leave, Resigned, Retired (defaults to Active if left blank)",
    "Gender: Male, Female, Other",
    "Marital Status: Single, Married",
    "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
    "Qualification Level: SSC, Intermediate, Degree, PG, etc. - up to 2 qualifications",
    "Responsibilities: Office Administration, Student Records, File Management, Accounts, Purchase, Examination Work, Admission Support, Documentation, Other - comma-separate multiple values",
    "Computer Skills: MS Office, ERP, Excel, Email, Document Management, Other - comma-separate multiple values",
    "Training Type: FDP, Workshop, MOOC, Certification, Skill Development, Administrative, ERP, Office Automation, Other",
    "Achievement Category: match whatever categories your college's Awards list uses (e.g. Best Employee, Appreciation)",
    "Department is optional - leave blank for centrally-managed roles, or set it to assign this staff member to a specific department",
    "Department accepts either the full name (e.g. \"Computer Science\") or the short Code (e.g. \"CSE\") - it must already exist under Departments, otherwise it's ignored",
    "Login Password (optional): fill this in to create this staff member's login account automatically during import, using their College Email (or Personal Email if no College Email is given) as the login ID - must be at least 8 characters. Leave it blank to import the record without a login.",
  ];
}
