// Supporting Staff CSV column definitions - used by the bulk-import
// template/preview on both the HOD (Technical) and College Office
// (Non-Technical) import pages, mirroring src/lib/faculty/csvColumns.ts for
// the Teaching Faculty import. Each caller is locked to its own category -
// mismatched rows are rejected by the API
// (src/app/api/college/supporting-staff/import/route.ts). Personal/employment
// columns are shared; Qualifications/Training/Achievements are shared
// *structures* but populated separately per caller; skills/responsibilities/
// certifications are entirely disjoint between categories (see
// TechnicalProfile/NonTechnicalProfile in src/types/supportingStaff.ts) - so
// getSupportingStaffColumns()/getSupportingStaffHints() compose the final
// column list per category rather than sharing one flat array.

import type { SupportingStaffCategory } from "@/types";

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
  { key: "staffCategory",      label: "Staff Category",               required: false, sample: "Technical", aliases: ["Category", "Staff Type"] },
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
];

// Qualifications are a shared *structure* (StaffQualification[]) for both
// categories, just with different `level` vocabularies (Diploma/B.Tech-B.Sc/
// M.Tech-MCA for Technical vs SSC/Intermediate/Degree/PG for Non-Technical).
function qualificationColumns(category: SupportingStaffCategory): SupportingStaffCsvColumn[] {
  const levelSample = category === "TECHNICAL" ? "Diploma" : "SSC";
  const cols: SupportingStaffCsvColumn[] = [];
  for (const n of [1, 2] as const) {
    cols.push(
      { key: `qualification${n}_level`,          label: `Qualification ${n} - Level`,          required: false, sample: n === 1 ? levelSample : "" },
      { key: `qualification${n}_degreeAndBranch`, label: `Qualification ${n} - Degree & Branch`, required: false, sample: "" },
      { key: `qualification${n}_university`,      label: `Qualification ${n} - University/Board`, required: false, sample: "" },
      { key: `qualification${n}_percentage`,      label: `Qualification ${n} - Percentage/Division`, required: false, sample: "" },
      { key: `qualification${n}_year`,            label: `Qualification ${n} - Year of Completion`, required: false, sample: "" },
    );
  }
  return cols;
}

// Training and Achievements are also a shared structure (TrainingEntry[] /
// AwardEntry[], reused from core.ts) across both categories.
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

// ─── Technical-only (TechnicalProfile) ─────────────────────────────────────────
const TECHNICAL_COLUMNS: SupportingStaffCsvColumn[] = [
  { key: "programmingLanguages", label: "Programming Languages (comma-separated)", required: false, sample: "Python, Java" },
  { key: "operatingSystems",     label: "Operating Systems (comma-separated)",     required: false, sample: "Linux, Windows" },
  { key: "networking",           label: "Networking (comma-separated)",           required: false, sample: "" },
  { key: "databases",            label: "Databases (comma-separated)",            required: false, sample: "MySQL" },
  { key: "cloud",                label: "Cloud (comma-separated)",                required: false, sample: "" },
  { key: "hardware",             label: "Hardware (comma-separated)",             required: false, sample: "" },
  { key: "softwareTools",        label: "Software Tools (comma-separated)",       required: false, sample: "" },
  { key: "responsibilities",     label: "Responsibilities (comma-separated)",     required: false, sample: "Lab Maintenance, Student Support" },
  { key: "otherResponsibility",  label: "Other Responsibility (if Other selected)", required: false, sample: "" },
  { key: "certification1_vendor", label: "Certification 1 - Vendor",  required: false, sample: "" },
  { key: "certification1_name",   label: "Certification 1 - Name",    required: false, sample: "" },
  { key: "certification1_year",   label: "Certification 1 - Year",    required: false, sample: "" },
  { key: "certification2_vendor", label: "Certification 2 - Vendor",  required: false, sample: "" },
  { key: "certification2_name",   label: "Certification 2 - Name",    required: false, sample: "" },
  { key: "certification2_year",   label: "Certification 2 - Year",    required: false, sample: "" },
  { key: "innovationsAndAutomation", label: "Innovations / Automation Developed", required: false, sample: "" },
];

// ─── Non-Technical-only (NonTechnicalProfile) ──────────────────────────────────
const NON_TECHNICAL_COLUMNS: SupportingStaffCsvColumn[] = [
  { key: "responsibilities",    label: "Responsibilities (comma-separated)",    required: false, sample: "Office Administration, Documentation" },
  { key: "otherResponsibility", label: "Other Responsibility (if Other selected)", required: false, sample: "" },
  { key: "computerSkills",      label: "Computer Skills (comma-separated)",     required: false, sample: "MS Office, Excel" },
  { key: "otherComputerSkill",  label: "Other Computer Skill (if Other selected)", required: false, sample: "" },
  { key: "typingSpeedWpm",      label: "Typing Speed (WPM)",                    required: false, sample: "" },
];

const OTHER_INFO_COLUMN: SupportingStaffCsvColumn = { key: "otherInformation", label: "Other Information", required: false, sample: "" };

export function getSupportingStaffColumns(category: SupportingStaffCategory): SupportingStaffCsvColumn[] {
  const isTechnical = category === "TECHNICAL";
  const personal = PERSONAL_COLUMNS.map((c) => {
    if (c.key === "staffCategory") return { ...c, label: `Staff Category (${isTechnical ? "Technical" : "Non-Technical"})`, sample: isTechnical ? "Technical" : "Non-Technical" };
    if (c.key === "designation") return { ...c, sample: isTechnical ? "Lab Assistant" : "Office Staff" };
    return c;
  });
  return [
    ...personal,
    ...qualificationColumns(category),
    ...(isTechnical ? TECHNICAL_COLUMNS : NON_TECHNICAL_COLUMNS),
    ...TRAINING_COLUMNS,
    ...ACHIEVEMENT_COLUMNS,
    OTHER_INFO_COLUMN,
  ];
}

export function getSupportingStaffHints(category: SupportingStaffCategory): string[] {
  const isTechnical = category === "TECHNICAL";
  return [
    `Staff Category: only ${isTechnical ? "Technical" : "Non-Technical"} staff can be imported here - mismatched rows are skipped`,
    isTechnical
      ? "Technical Designation: Lab Assistant, Programmer, System Administrator, Network Engineer, Other"
      : "Non-Technical Designation: Office Staff, Accountant, Librarian, Clerk, Attender, Office Assistant, Other",
    "Employment Type: Permanent, Contract, Visiting, Part-Time (defaults to Permanent if left blank or unrecognized)",
    "Status: Active, On Leave, Resigned, Retired (defaults to Active if left blank)",
    "Gender: Male, Female, Other",
    "Marital Status: Single, Married",
    "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
    isTechnical
      ? "Qualification Level: Diploma, B.Tech, B.Sc, M.Tech, MCA, etc. - up to 2 qualifications"
      : "Qualification Level: SSC, Intermediate, Degree, PG, etc. - up to 2 qualifications",
    isTechnical
      ? "Responsibilities: Lab Maintenance, Equipment Maintenance, Software Installation, Network Administration, Lab Stock Maintenance, Student Support, Practical Sessions, Other - comma-separate multiple values"
      : "Responsibilities: Office Administration, Student Records, File Management, Accounts, Purchase, Examination Work, Admission Support, Documentation, Other - comma-separate multiple values",
    isTechnical
      ? "Certification Vendor: Cisco, Microsoft, AWS, RedHat, Oracle, Google, VMware, Other"
      : "Computer Skills: MS Office, ERP, Excel, Email, Document Management, Other - comma-separate multiple values",
    "Training Type: FDP, Workshop, MOOC, Certification, Skill Development, Administrative, ERP, Office Automation, Other",
    "Achievement Category: match whatever categories your college's Awards list uses (e.g. Best Employee, Appreciation)",
    isTechnical
      ? "Department is optional - leave blank for centrally-managed roles or for it to default to your own department"
      : "Department is optional - leave blank for centrally-managed roles, or set it to assign this staff member to a specific department",
    "Department accepts either the full name (e.g. \"Computer Science\") or the short Code (e.g. \"CSE\") - it must already exist under Departments, otherwise it's ignored",
    "Login Password (optional): fill this in to create this staff member's login account automatically during import, using their College Email (or Personal Email if no College Email is given) as the login ID - must be at least 8 characters. Leave it blank to import the record without a login.",
  ];
}
