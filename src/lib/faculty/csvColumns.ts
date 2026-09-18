import { HIGHEST_QUALIFICATION_OPTIONS } from "@/lib/import/fieldConstraints";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";

// Faculty CSV column definitions.
//
// getFacultyImportColumns/getFacultyImportHints/getFacultyImportSampleRows
// (below EXPORT_FIELDS) build the only columns the bulk-import template
// (src/app/(dashboard)/hod/faculty/import/page.tsx) and import route
// (src/app/api/college/faculty/import/route.ts) accept - deliberately just
// the core identity/employment fields, not the full Academic Profile.
// EXPORT_FIELDS remains the full field set used only by the full-detail
// export (src/lib/faculty/exportFacultyCsv.ts + ExportFacultyDialog) - import
// and export are intentionally no longer symmetric.

// ─── Export field definitions ──────────────────────────────────────────────
//
// One entry per exportable field, grouped by the same module a faculty
// member's own profile is organized into everywhere else in the app (see
// PROFILE_MODULES in profileModules.ts, and the Add/Edit wizard's own steps
// in hod/faculty/new/page.tsx). "core" stands in for the wizard's "Identity &
// Employment" step, which isn't part of PROFILE_MODULES itself.
//
// A "scalar" field maps to exactly one CSV column with a plain value. A
// "group" field also maps to exactly one CSV column, but its value combines
// every entry of a repeating list (e.g. a faculty member's UG/PG/PhD degrees,
// previous jobs, publications, ...) into that single cell - one line per
// entry, labelled "<Label> <n>: <SubField>: <value> | ..." the same way the
// Add/Edit form numbers a repeated entry ("PhD Details 2", see
// DegreeFieldsList in ProfileFieldPrimitives.tsx). See combineGroup in
// exportFacultyCsv.ts for how a group's cell is actually built.
export type ExportModuleKey = "core" | ProfileModuleKey;

export const EXPORT_MODULE_ORDER: ExportModuleKey[] = [
  "core", "personal", "qualification", "experience", "research",
  "mentorship", "financial", "others", "teaching-load",
];

export const EXPORT_MODULE_LABELS: Record<ExportModuleKey, string> = {
  core: "Identity & Employment",
  ...Object.fromEntries(Object.entries(PROFILE_MODULES).map(([k, m]) => [k, m.label])) as Record<ProfileModuleKey, string>,
};

interface ExportFieldBase {
  key: string;
  label: string;
  module: ExportModuleKey;
  // true only for "core"/"personal" fields - reproduces today's export
  // untouched when the HOD opens the dialog and exports without changing
  // anything.
  defaultSelected: boolean;
}

export interface ExportScalarField extends ExportFieldBase {
  kind: "scalar";
}

export interface ExportGroupField extends ExportFieldBase {
  kind: "group";
  // Ordered sub-field labels rendered for each entry's line, e.g.
  // ["Degree", "Branch", "University/Institute", "Percentage/CGPA", "Year of Completion"].
  subFieldLabels: string[];
}

export type ExportField = ExportScalarField | ExportGroupField;

function scalar(module: ExportModuleKey, key: string, label: string, defaultSelected = false): ExportScalarField {
  return { kind: "scalar", module, key, label, defaultSelected };
}

function group(module: ExportModuleKey, key: string, label: string, subFieldLabels: string[]): ExportGroupField {
  return { kind: "group", module, key, label, subFieldLabels, defaultSelected: false };
}

const DEGREE_SUBFIELDS = ["Degree", "Branch", "University/Institute", "Percentage/CGPA", "Year of Completion"];
const PHD_SUBFIELDS = ["Degree", "Specialization", "University/Institute", "Year of Completion"];
const EXPERIENCE_SUBFIELDS = ["Institution Name", "Designation", "From Date", "To Date", "Joining Salary", "Leaving Salary", "Reason for Leaving", "NOC Obtained"];

export const EXPORT_FIELDS: ExportField[] = [
  // ─── Identity & Employment (core) - default ON ───────────────────────────
  // Ordered to match the Add Faculty wizard's own "Identity & Employment"
  // step (hod/faculty/new/page.tsx); fields with no add-form home (AICTE
  // Eligible, Status, Employment Type, Date of Joining Department, Official
  // Email) are appended at the end rather than interleaved.
  scalar("core", "employeeId", "Employee ID", true),
  scalar("core", "legalName", "Full Name (as per SSC)", true),
  scalar("core", "name", "Name (as per PAN)", true),
  scalar("core", "apaarFacultyId", "APAAR Faculty ID", true),
  scalar("core", "collegeEmail", "College Email", true),
  scalar("core", "designation", "Designation", true),
  scalar("core", "qualification", "Qualification (Summary)", true),
  scalar("core", "specialization", "Specialization", true),
  scalar("core", "experienceYears", "Total Experience (Years)", true),
  // Internal/External Experience are computed live from joiningDate and the
  // Academic/Industry/Research Experience entries - not stored fields (see
  // FacultyIdentityFacts on the profile page, which computes the same way).
  scalar("core", "internalExperience", "Internal Exp (Years)", true),
  scalar("core", "externalExperience", "External Exp (Years)", true),
  scalar("core", "joiningDate", "Date of Joining Institution", true),
  scalar("core", "aicteFacultyId", "AICTE Faculty ID", true),
  scalar("core", "email", "Personal Email", true),
  scalar("core", "phone", "Mobile No", true),
  group("core", "additionalPhones", "Additional Phone Numbers", ["Label", "Number"]),
  scalar("core", "aicteEligible", "AICTE Eligible", true),
  scalar("core", "status", "Status", true),
  scalar("core", "employeeCategory", "Employee Category", true),
  scalar("core", "employmentType", "Employment Type (legacy)", true),
  scalar("core", "dateOfJoiningDepartment", "Date of Joining Department", true),
  scalar("core", "officialEmail", "Official Email", true),

  // ─── Personal Details - default ON ───────────────────────────────────────
  // Ordered to match PersonalDetailsFields.tsx (the canonical Add/Edit order).
  scalar("personal", "nameAsPerAadhar", "Name (as per Aadhar)", true),
  scalar("personal", "dateOfBirth", "Date of Birth", true),
  scalar("personal", "gender", "Gender", true),
  scalar("personal", "fatherName", "Father Name", true),
  scalar("personal", "motherName", "Mother Name", true),
  scalar("personal", "religion", "Religion", true),
  scalar("personal", "caste", "Caste", true),
  scalar("personal", "subCaste", "Sub Caste", true),
  scalar("personal", "aadharNo", "Aadhar No", true),
  scalar("personal", "panNo", "PAN No", true),
  scalar("personal", "passportNumber", "Passport No", true),
  scalar("personal", "differentlyAbled", "Differently Abled", true),
  scalar("personal", "differentlyAbledDetails", "Differently Abled - Details", true),
  scalar("personal", "motherTongue", "Mother Tongue", true),
  scalar("personal", "languagesKnown", "Languages Known", true),
  scalar("personal", "heightFeet", "Height (Feet)", true),
  scalar("personal", "heightInches", "Height (Inches)", true),
  scalar("personal", "weightKg", "Weight (Kg)", true),
  scalar("personal", "maritalStatus", "Marital Status", true),
  scalar("personal", "bloodGroup", "Blood Group", true),
  scalar("personal", "spouseName", "Spouse Name", true),
  scalar("personal", "numberOfChildren", "Number of Children", true),
  scalar("personal", "temporaryAddress", "Temporary Address", true),
  scalar("personal", "permanentSameAsTemporary", "Permanent Same as Temporary", true),
  scalar("personal", "permanentAddress", "Permanent Address", true),
  scalar("personal", "bankAccountNo", "Bank A/C Number", true),
  scalar("personal", "ifscCode", "IFSC Code", true),
  scalar("personal", "bankName", "Bank Name", true),
  scalar("personal", "bankBranch", "Branch", true),
  scalar("personal", "pfNumber", "PF Number", true),
  scalar("personal", "bankOtherDetails", "Bank Other Details", true),
  scalar("personal", "emergencyContactName", "Emergency Contact Person Name", true),
  scalar("personal", "emergencyContactRelation", "Relation (with Emergency Contact)", true),
  scalar("personal", "emergencyContactPhone", "Emergency Contact Mobile No", true),
  scalar("personal", "ratificationStatus", "Ratification Status", true),
  scalar("personal", "ratificationProceedingsNumber", "Proceedings Number", true),
  scalar("personal", "ratificationDate", "Ratification Proceedings Date", true),

  // ─── Academic Qualification ───────────────────────────────────────────────
  // Ordered to match the Add Faculty wizard's own Qualification step
  // (QualificationFields in AcademicProfileModuleFields.tsx).
  scalar("qualification", "highestQualification", "Highest Qualification"),
  scalar("qualification", "researchAreas", "Research Areas/Interests"),
  scalar("qualification", "qualifyingExamQualified", "NET/SLET/SET/GATE/Others Qualified"),
  scalar("qualification", "qualifyingExam", "Qualified Exam"),
  scalar("qualification", "otherQualifyingExam", "Qualified Exam (Other, specified)"),
  scalar("qualification", "qualifyingExamScore", "Qualified Exam Score"),
  scalar("qualification", "qualifyingExamYear", "Qualified Year"),
  group("qualification", "highSchoolDetails", "Secondary Education (10th)", ["Qualification", "Board", "School", "Percentage/CGPA", "Year of Passing"]),
  group("qualification", "intermediateDetails", "Intermediate/Diploma (12th)", ["Qualification", "Board", "College", "Percentage/CGPA", "Year of Passing"]),
  group("qualification", "ugDetailsGroup", "UG Details", DEGREE_SUBFIELDS),
  group("qualification", "pgDetailsGroup", "PG Details", DEGREE_SUBFIELDS),
  group("qualification", "phdDetailsGroup", "Ph.D. Details", PHD_SUBFIELDS),
  scalar("qualification", "phdStatus", "Ph.D. Status"),
  scalar("qualification", "phdMode", "Ph.D. Mode"),
  scalar("qualification", "phdSupervisorName", "Ph.D. Project Supervisor Name"),
  scalar("qualification", "fellowshipsReceived", "Fellowships Received"),
  group("qualification", "postDoctoralDetailsGroup", "Postdoctoral Fellowship Details", DEGREE_SUBFIELDS),
  group("qualification", "schoolQualifications", "School Qualifications", ["Level", "Degree/Certificate", "University/Institute/Board", "Percentage/CGPA", "Year of Completion"]),

  // ─── Professional Experience ──────────────────────────────────────────────
  scalar("experience", "primaryTeachingRole", "Teaching Roles/Responsibilities"),
  scalar("experience", "primaryIndustryRole", "Industry Roles/Responsibilities"),
  scalar("experience", "primaryResearchRole", "Research Roles/Responsibilities"),
  group("experience", "previousInstitutionsGroup", "Academic Experience", EXPERIENCE_SUBFIELDS),
  group("experience", "industryExperienceGroup", "Industry Experience", EXPERIENCE_SUBFIELDS),
  group("experience", "researchExperienceGroup", "Research Experience", EXPERIENCE_SUBFIELDS),
  group("experience", "promotionHistoryGroup", "Teaching / Promotion History", ["Designation", "From Date", "To Date"]),
  group("experience", "coursesGroup", "Courses Taught", ["Code", "Name", "Weekly Credit Hours"]),

  // ─── Research & Innovation ─────────────────────────────────────────────────
  scalar("research", "publicationsFirstOrCorrespondingAuthor", "First/Corresponding Author Pubs"),
  scalar("research", "publicationsQ1OrHighImpact", "Q1 / IF>4.0 Pubs"),
  scalar("research", "sciScopusCount", "SCI/Scopus Count"),
  scalar("research", "wosCount", "WoS (SCIE/ESCI) Count"),
  scalar("research", "conferencePapersCount", "Conference Papers"),
  scalar("research", "bookChaptersCount", "Book Chapters"),
  scalar("research", "reviewPublicationsCount", "Review Publications"),
  scalar("research", "totalPublications", "Total Publications (incl. co-authorship)"),
  scalar("research", "totalCitations", "Total Citations"),
  scalar("research", "hIndex", "H-Index"),
  scalar("research", "i10Index", "i10-Index"),
  scalar("research", "orcidId", "ORCID iD"),
  scalar("research", "scopusAuthorId", "Scopus Author ID"),
  scalar("research", "researcherId", "Researcher ID (WoS/Publons)"),
  scalar("research", "googleScholarId", "Google Scholar ID"),
  scalar("research", "irinsProfile", "IRINS Profile"),
  group("research", "publicationsGroup", "Publications", ["Title", "Co-Authors", "Journal/Conference", "Year", "Indexing"]),
  group("research", "authoredBooksGroup", "Authored Books", ["Title", "Publisher", "Year"]),

  // ─── Professional Development ──────────────────────────────────────────────
  group("mentorship", "labsEstablishedGroup", "New Labs Established", ["Facility Details", "Outcomes"]),
  group("mentorship", "adminResponsibilityGroup", "Academic Responsibilities", ["Category", "Description", "From Year", "To Year"]),
  group("mentorship", "trainingEntriesGroup", "Trainings / FDPs / Workshops", ["Type", "Participated/Conducted", "Title", "Organizer", "Year", "Duration (Days)"]),
  group("mentorship", "professionalMembershipsGroup", "Professional Body Memberships", ["Body", "Body Name (if Other)", "Membership ID", "Member Since (Year)"]),
  group("mentorship", "awardEntriesGroup", "Awards & Recognition", ["Category", "Title", "Awarding Body", "Year"]),

  // ─── Financial Standing ─────────────────────────────────────────────────────
  scalar("financial", "presentSalary", "Monthly Salary (₹)"),
  scalar("financial", "grossAnnualCTC", "Gross Annual CTC (₹)"),
  scalar("financial", "incrementsAwarded", "Increments Awarded"),
  scalar("financial", "fundingConsultancyRevenue", "Funding/Consultancy Revenue Generation (₹)"),

  // ─── Others ─────────────────────────────────────────────────────────────────
  scalar("others", "otherInformation", "Other Information"),

  // ─── Teaching Load ────────────────────────────────────────────────────────
  // Relational - sourced from the Teaching Assignments module, not a stored
  // field on the faculty document itself (see currentTeachingSummary in
  // exportFacultyCsv.ts).
  scalar("teaching-load", "currentTeachingSummary", "Current Teaching (Course / Year / Section / Subject)"),
];

export const HINTS = [
  "Designation: any teaching title used by your college (e.g. Professor, Assoc. Prof., Asst. Prof., Lecturer, Visiting Faculty, Adjunct Faculty for Engineering/Pharmacy/Dental; Principal, HOD, PGT, TGT, PRT etc. for Degree/Polytechnic/School colleges)",
  "Status: Active, On Leave, Resigned, Retired (defaults to Active if left blank)",
  "Gender: Male, Female, Other",
  "Marital Status: Single, Married",
  "Ratification Status: Ratified, Not Ratified",
  "Has PhD: Yes or No",
  "AICTE Eligible: Yes or No",
  "Funded Project Role: PI or Co-PI",
  "Admin Responsibility Category: Coordinator Role, Committee Membership, NBA / NAAC Work, IQAC, Examination Duty, Other",
  "Training Type: FDP, Workshop, MOOC, Certification, Skill Development, Administrative Training, ERP Training, Office Automation Training, Other",
  "Membership Body: IEEE, ISTE, CSI, ACM, IEI, Other",
  "Award Category: Best Teacher Award, Research Award, Appreciation Certificate, Other",
  "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
  "Total Years of Experience: the faculty member's ENTIRE professional/teaching experience, including time served at previous institutions - not just their years at this college. For someone who taught 8 years elsewhere and 2 here, enter 10.",
  "Department is auto-assigned from your HOD profile",
  "Login Password (optional): fill this in to create the faculty member's login account (as a Panel Member) automatically during import, using their College Email (or Personal Email if no College Email is given) as the login ID - must be at least 8 characters. Leave it blank to skip login creation for that row; you can still set it up later from the Faculty list's \"Set Login\" button.",
  "Resume/CV URL: an already-hosted link (Drive/Storage) - this template doesn't upload files directly; use the faculty edit page's Documents section to upload one",
];

// ─── Bulk-import template - core fields only ──────────────────────────────────
// Every column here is mandatory - this template is deliberately limited to
// the identity/employment/statutory fields a faculty member needs on day
// one. Personal-detail extras (father/mother name, religion, bank details,
// addresses, etc.) and the Academic Profile aren't part of this template -
// fill those in afterward from the Edit Faculty page.
// Designation is this college's own admin-curated catalog (see
// DesignationCatalogCard) - no hardcoded list, no "Other" any more, so the
// template's own instructions have to be built from whatever the admin
// actually configured rather than a fixed string, or they'd describe options
// that don't exist.
export interface FacultyCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  // Alternate header wordings that should still map to this column (see matchHeaders in csv.ts).
  aliases?: string[];
}

export function getFacultyImportColumns(designationOptions: string[]): FacultyCsvColumn[] {
  return [
  { key: "employeeId",   label: "Employee ID",   required: true,  sample: "Required; any text; unique", aliases: ["Emp ID", "Employee Code", "Employee No", "Staff ID"] },
  { key: "legalName",    label: "Full Name (as per SSC)", required: true, sample: "Required; text", aliases: ["Legal Name (as per SSC)"] },
  // Optional - matches the name on the faculty member's PAN card, for
  // statutory/financial paperwork only. Full Name (as per SSC) above is the
  // primary/required identity name used everywhere the app displays this
  // faculty member; when this column is left blank, that's what's used
  // instead (see finalName in the import route).
  // "Full Name" (bare) and "Full Name (as per PAN)" are deliberately NOT
  // aliased here - both would be genuinely ambiguous now that there are two
  // other name-shaped columns (Full Name as per SSC, Name as per Aadhar);
  // leave a header that vague unmatched rather than guess which one it means.
  { key: "name",         label: "Name (as per PAN)", required: false, sample: "Optional; full name exactly as on PAN card", aliases: ["Faculty Name", "Name", "Employee Name"] },
  { key: "collegeEmail", label: "College Email", required: true,  sample: "Required; must contain @", aliases: ["Email", "Email ID"] },
  { key: "password",     label: "Login Password (min 8 characters)", required: true, sample: "Required; minimum 8 characters", aliases: ["Password"] },
  { key: "phone",        label: "Mobile No",     required: true, sample: "Required; phone/text", aliases: ["Phone", "Mobile", "Mobile Number", "Phone Number", "Contact Number"] },
  { key: "designation",  label: "Designation",   required: true,  sample: designationOptions.length
      ? `Required: ${designationOptions.join(" / ")} - common abbreviations (Prof., Asst. Prof., Assoc. Prof.) are accepted too`
      : "Required - add at least one Designation under Settings > Designations first" },
  // Names the same options the Add/Edit Faculty dropdown offers, so a sheet
  // uses the spellings the form produces rather than inventing "PhD"/"Mtech".
  // Still accepts anything else, deliberately: the dropdown's own "Others"
  // stores whatever was typed, so a closed set here would reject qualifications
  // the app itself can create.
  { key: "qualification", label: "Highest Qualification", required: true, sample: `Required; ${HIGHEST_QUALIFICATION_OPTIONS.join(" / ")} / other`, aliases: ["Qualification"] },
  { key: "joiningDate",  label: "Date of Joining Institution (DD-MM-YYYY)", required: true, sample: "Required; DD-MM-YYYY", aliases: ["Joining Date", "Date of Joining", "DOJ"] },
  { key: "gender",            label: "Gender",                       required: true, sample: "Required: Male / Female / Other" },
  { key: "dateOfBirth",       label: "Date of Birth (DD-MM-YYYY)",   required: true, sample: "Required; DD-MM-YYYY", aliases: ["DOB"] },
  { key: "nameAsPerAadhar",   label: "Name (as per Aadhar)",         required: false, sample: "Optional; text" },
  { key: "aadharNo",          label: "Aadhar No",                    required: true, sample: "Required; text" },
  { key: "panNo",             label: "PAN No",                       required: true, sample: "Required; text" },
  { key: "ratificationStatus",label: "Ratification Status",          required: true, sample: "Required: Ratified / Not Ratified" },
  ];
}

// Five filled-in rows for the template workbook's second sheet - what a
// correctly-completed row looks like for every column, which the guidance row
// on sheet one can only describe. Keyed by column key rather than written as a
// positional array so adding or reordering a column can't silently shift the
// data under the wrong headers. Designation cycles through this college's own
// live catalog (falling back to a plain placeholder if the admin hasn't added
// any yet) so every sample row is itself a value that would actually pass
// import, not a stale hardcoded title.
//
// Login Password now gets a real, distinct-per-row sample value since the
// column is mandatory (every row creates a real login on import) - each one
// MUST be changed to something unique before real use; see the Login
// Password hint below. Never reuse these literal strings for a real account.
export function getFacultyImportSampleRows(designationOptions: string[]): Record<string, string>[] {
  const designation = (i: number) => designationOptions[i % designationOptions.length] ?? "";
  return [
  {
    employeeId: "FAC001", legalName: "ANITHA REDDY", name: "Dr. Anitha Reddy",
    collegeEmail: "anitha.reddy@college.edu", password: "ChangeMe#101", phone: "9876543210",
    designation: designation(0), qualification: "Ph.D",
    joiningDate: "15-06-2012",
    gender: "Female", dateOfBirth: "22-03-1978",
    nameAsPerAadhar: "Anitha Reddy",
    aadharNo: "123456789012", panNo: "ABCDE1234F",
    ratificationStatus: "Ratified",
  },
  {
    employeeId: "FAC002", legalName: "SURESH KUMAR", name: "Mr. Suresh Kumar",
    collegeEmail: "suresh.kumar@college.edu", password: "ChangeMe#102", phone: "9876543211",
    designation: designation(1), qualification: "M.Tech",
    joiningDate: "01-07-2019",
    gender: "Male", dateOfBirth: "05-11-1990",
    nameAsPerAadhar: "Suresh Kumar",
    aadharNo: "234567890123", panNo: "BCDEF2345G",
    ratificationStatus: "Ratified",
  },
  {
    employeeId: "FAC003", legalName: "DIVYA NAIR", name: "Ms. Divya Nair",
    collegeEmail: "divya.nair@college.edu", password: "ChangeMe#103", phone: "9876543212",
    designation: designation(2), qualification: "M.Tech",
    joiningDate: "16-08-2022",
    gender: "Female", dateOfBirth: "30-01-1995",
    nameAsPerAadhar: "Divya Nair",
    aadharNo: "345678901234", panNo: "CDEFG3456H",
    ratificationStatus: "Not Ratified",
  },
  {
    employeeId: "FAC004", legalName: "IMRAN SHAIK", name: "Dr. Imran Shaik",
    collegeEmail: "imran.shaik@college.edu", password: "ChangeMe#104", phone: "9876543213",
    designation: designation(3), qualification: "Ph.D",
    joiningDate: "04-01-2016",
    gender: "Male", dateOfBirth: "19-07-1984",
    nameAsPerAadhar: "Imran Shaik",
    aadharNo: "456789012345", panNo: "DEFGH4567I",
    ratificationStatus: "Ratified",
  },
  {
    employeeId: "FAC005", legalName: "GRACE THOMAS", name: "Mrs. Grace Thomas",
    collegeEmail: "grace.thomas@college.edu", password: "ChangeMe#105", phone: "9876543214",
    designation: designation(4), qualification: "M.Sc",
    joiningDate: "12-06-2023",
    gender: "Female", dateOfBirth: "08-09-1996",
    nameAsPerAadhar: "Grace Thomas",
    aadharNo: "567890123456", panNo: "EFGHI5678J",
    ratificationStatus: "Not Ratified",
  },
  ];
}

export function getFacultyImportHints(designationOptions: string[]): string[] {
  return [
  "Full Name (as per SSC): enter the name exactly as it appears on the faculty member's SSC (10th class) certificate, in CAPITAL LETTERS - this is the PRIMARY identity name used as their display name everywhere across the app (lists, PDFs, notifications, teaching assignments, etc.).",
  "Name (as per PAN): optional - only needed for statutory/financial paperwork matching. When left blank, Full Name (as per SSC) is used instead everywhere this faculty member's name is shown.",
  designationOptions.length
    ? `Designation: ${designationOptions.join(" / ")} - added under Settings > Designations. Supporting Staff (Lab Assistant, Programmer, Office Assistant, etc.) is added from the Supporting Staff module instead. Common abbreviations (e.g. Prof., Asst. Prof., Assoc. Prof.) are recognized too, case-insensitively.`
    : "Designation: add at least one under Settings > Designations before importing - a row can only use a title that's been added there.",
  "Dates must be in DD-MM-YYYY format (e.g. 15-06-2020)",
  "Department is auto-assigned from your HOD profile",
  "Login Password is mandatory: it creates the faculty member's login account (as a Panel Member) automatically during import, using their College Email as the login ID - must be at least 8 characters. Use a real, unique password per person - never reuse the sample column's placeholder values.",
  "Every column above is required except Name (as per PAN) and Name (as per Aadhar) - a row missing a required one, or with an invalid value, is rejected and reported back so it can be corrected and re-imported.",
  "Personal details beyond what's above (father/mother name, religion, bank details, addresses, etc.) and the Academic Profile aren't part of this template - fill those in afterward from the Edit Faculty page.",
  ];
}
