import type {
  CertificateCategory, CertificateFieldDef, CertificateTemplate, CertificateTemplateKind, CertificateTypeConfig, FlowStepDef, RecipientResolver, UserRole,
} from "@/types";

// The starter catalogue: the 28 certificates colleges commonly issue, each with its own template. Installed on request
// by the Principal / College Admin (never automatically), only for entries the college doesn't have yet - an installed
// type or template is never overwritten (Setup offers "Reset to starter" for one not yet used). Everything arrives
// switched OFF except No Dues (it replaces the original No Due flow),
// so a college reviews each one - approvers, fee, wording - before students see it.

type Flow = FlowStepDef[];
const role = (r: UserRole): RecipientResolver => ({ kind: "ROLE", role: r });
const HOD: RecipientResolver = { kind: "STUDENT_DEPARTMENT_HOD" };
const MENTOR: RecipientResolver = { kind: "STUDENT_MENTOR" };
const INCHARGE: RecipientResolver = { kind: "CLASS_INCHARGE" };
const seq = (id: string, label: string, recipient: RecipientResolver): FlowStepDef => ({ id, type: "SEQUENTIAL", label, recipient });

const MENTOR_STEP = seq("mentor", "Mentor", MENTOR);
const HOD_STEP = seq("hod", "HOD verification", HOD);
const PRINCIPAL_STEP = seq("principal", "Principal approval", role("PRINCIPAL"));
const EXAM_STEP = seq("examCell", "Exam Cell verification", role("EXAM_CELL"));
const ACCOUNTS_STEP = seq("accounts", "Accounts verification", role("COLLEGE_ACCOUNTS"));
const DUES_STEP: FlowStepDef = {
  id: "clearances", type: "PARALLEL", label: "Department clearances",
  branches: [
    { key: "LIBRARY", label: "Library (books)", recipient: role("LIBRARY") },
    { key: "HOSTEL", label: "Hostel (fee)", recipient: role("HOSTEL") },
    { key: "PLACEMENT_DEPT", label: "Placement Cell (CRT fee)", recipient: role("PLACEMENT_DEPT") },
    { key: "PD", label: "Physical Education (sports kit)", recipient: role("PD") },
  ],
};

const f = (key: string, label: string, kind: CertificateFieldDef["kind"] = "text", required = true, extra: Partial<CertificateFieldDef> = {}): CertificateFieldDef =>
  ({ key, label, kind, required, ...extra });

const STUDYING = ["REGULAR", "DETAINED"] as CertificateTypeConfig["eligibility"]["statuses"];
const PASSED_OUT = ["GRADUATED"] as CertificateTypeConfig["eligibility"]["statuses"];
const LEFT = ["GRADUATED", "DISCONTINUED"] as CertificateTypeConfig["eligibility"]["statuses"];

const STUDENT_LINE = "This is to certify that {{MrMs}} {{studentName}}, {{sonDaughter}} of {{fatherName}}, bearing Regd. No {{rollNumber}},";
const STUDYING_LINE = "is a bonafide student of this college, studying {{year}} year {{course}} ({{branch}}) during the academic year {{academicYear}}.";
const REQUEST_LINE = "This certificate is issued at {{hisHer}} request for the purpose of {{purpose}}.";

interface Entry {
  key: string;
  code: string;
  name: string;
  category: CertificateCategory;
  description: string;
  statuses?: CertificateTypeConfig["eligibility"]["statuses"];
  purposes?: string[];
  allowOtherPurpose?: boolean;
  fields?: CertificateFieldDef[];
  attachments?: CertificateTypeConfig["attachments"];
  onceOnly?: boolean;
  feeAmount?: number;
  flow: Flow;
  issuer?: RecipientResolver;
  issuerFields?: CertificateFieldDef[];
  delivery?: CertificateTypeConfig["delivery"];
  startedBy?: CertificateTypeConfig["startedBy"];
  template: { kind: CertificateTemplateKind; title: string; body?: string; rows?: { label: string; value: string }[]; marksKind?: CertificateTemplate["marksKind"]; footer?: string; showQr?: boolean; showClearances?: boolean };
}

const GENERAL_PURPOSES = ["Higher studies", "Employment", "Passport", "Bank account", "Scholarship", "Government scheme"];

const ENTRIES: Entry[] = [
  {
    key: "BONAFIDE", code: "BON", name: "Bonafide Certificate", category: "IDENTITY",
    description: "Confirms you are a student of the college this year.", statuses: STUDYING, purposes: GENERAL_PURPOSES, allowOtherPurpose: true,
    flow: [HOD_STEP, PRINCIPAL_STEP],
    template: { kind: "LETTER", title: "BONAFIDE CERTIFICATE", body: `${STUDENT_LINE} ${STUDYING_LINE}\n\n${REQUEST_LINE}` },
  },
  {
    key: "STUDY", code: "STD", name: "Study Certificate", category: "IDENTITY",
    description: "States the years you studied at the college.", purposes: GENERAL_PURPOSES, allowOtherPurpose: true,
    flow: [HOD_STEP, PRINCIPAL_STEP],
    issuerFields: [f("studyPeriod", "Period of study (e.g. 2022-23 to 2025-26)")],
    template: { kind: "LETTER", title: "STUDY CERTIFICATE", body: `${STUDENT_LINE} has studied {{course}} ({{branch}}) in this college during the period {{studyPeriod}}.\n\n${REQUEST_LINE}` },
  },
  {
    key: "ENROLLMENT", code: "ENR", name: "Student Status / Enrollment Certificate", category: "IDENTITY",
    description: "Confirms your current enrolment and year of study.", statuses: STUDYING, purposes: GENERAL_PURPOSES, allowOtherPurpose: true,
    flow: [HOD_STEP],
    template: { kind: "LETTER", title: "ENROLLMENT CERTIFICATE", body: `${STUDENT_LINE} is enrolled in {{course}} ({{branch}}), batch {{batch}}, regulation {{regulation}}, and is at present in {{year}} year, section {{section}}, for the academic year {{academicYear}}.\n\n${REQUEST_LINE}` },
  },
  {
    key: "CONDUCT", code: "CON", name: "Conduct Certificate", category: "IDENTITY",
    description: "States your conduct during your study.", purposes: GENERAL_PURPOSES, allowOtherPurpose: true,
    flow: [HOD_STEP, PRINCIPAL_STEP],
    issuerFields: [f("conduct", "Conduct", "select", true, { options: ["Good", "Very Good", "Satisfactory"], defaultValue: "Good" })],
    template: { kind: "LETTER", title: "CONDUCT CERTIFICATE", body: `${STUDENT_LINE} {{studentStatus}} {{course}} ({{branch}}) in this college. During {{hisHer}} period of study, {{hisHer}} conduct has been {{conduct}}.\n\n${REQUEST_LINE}` },
  },
  {
    key: "CHARACTER", code: "CHR", name: "Character Certificate", category: "IDENTITY",
    description: "States your character, as known to the college.", purposes: GENERAL_PURPOSES, allowOtherPurpose: true,
    flow: [seq("incharge", "Class in-charge", INCHARGE), HOD_STEP, PRINCIPAL_STEP],
    issuerFields: [f("character", "Character", "select", true, { options: ["Good", "Very Good", "Excellent"], defaultValue: "Good" })],
    template: { kind: "LETTER", title: "CHARACTER CERTIFICATE", body: `${STUDENT_LINE} {{studentStatus}} {{course}} ({{branch}}) in this college. To the best of our knowledge, {{heShe}} bears a {{character}} moral character and has not been involved in any activity against the rules of the college.\n\n${REQUEST_LINE}` },
  },
  {
    key: "TC", code: "TC", name: "Transfer Certificate (TC)", category: "CLEARANCE",
    description: "Issued once when you leave the college. All dues must be cleared first.", statuses: LEFT, onceOnly: true, delivery: "PHYSICAL",
    flow: [DUES_STEP, HOD_STEP, PRINCIPAL_STEP],
    issuerFields: [
      f("dateOfLeaving", "Date of leaving", "date"), f("classAtLeaving", "Class at the time of leaving"),
      f("reasonForLeaving", "Reason for leaving", "select", true, { options: ["Completed the course", "Discontinued", "Transfer to another college"], defaultValue: "Completed the course" }),
      f("qualifiedForPromotion", "Qualified for promotion / completed", "select", true, { options: ["Yes", "No", "Results awaited"] }),
      f("conduct", "Conduct", "select", true, { options: ["Good", "Very Good", "Satisfactory"], defaultValue: "Good" }),
      f("remarks", "Remarks", "text", false),
    ],
    template: {
      kind: "FORM", title: "TRANSFER CERTIFICATE",
      rows: [
        { label: "Name of the student", value: "{{studentName}}" }, { label: "Regd. No / Admission No", value: "{{rollNumber}} / {{admissionNo}}" },
        { label: "Name of the father", value: "{{fatherName}}" }, { label: "Name of the mother", value: "{{motherName}}" },
        { label: "Nationality and religion", value: "{{nationality}}, {{religion}}" }, { label: "Caste", value: "{{caste}}" },
        { label: "Date of birth", value: "{{dateOfBirth}}" }, { label: "Date of admission", value: "{{dateOfAdmission}}" },
        { label: "Course and branch", value: "{{course}} ({{branch}})" }, { label: "Class at the time of leaving", value: "{{classAtLeaving}}" },
        { label: "Date of leaving", value: "{{dateOfLeaving}}" }, { label: "Reason for leaving", value: "{{reasonForLeaving}}" },
        { label: "Whether qualified for promotion", value: "{{qualifiedForPromotion}}" }, { label: "Conduct", value: "{{conduct}}" },
        { label: "Remarks", value: "{{remarks}}" },
      ],
    },
  },
  {
    key: "MIGRATION", code: "MIG", name: "Migration Certificate", category: "CLEARANCE",
    description: "Needed to join another university.", statuses: LEFT, onceOnly: true, feeAmount: 500, delivery: "PHYSICAL",
    fields: [f("joiningInstitution", "University / institution you are joining", "text", false)],
    flow: [EXAM_STEP, PRINCIPAL_STEP],
    issuerFields: [f("yearOfPassing", "Year of passing / leaving")],
    template: {
      kind: "FORM", title: "MIGRATION CERTIFICATE",
      rows: [
        { label: "Name of the student", value: "{{studentName}}" }, { label: "Regd. No", value: "{{rollNumber}}" },
        { label: "Name of the father", value: "{{fatherName}}" }, { label: "Course and branch", value: "{{course}} ({{branch}})" },
        { label: "Year of passing / leaving", value: "{{yearOfPassing}}" },
      ],
      footer: "The college has no objection to {{hisHer}} migrating to any other university / institution to continue {{hisHer}} studies.",
    },
  },
  {
    key: "COURSE_COMPLETION", code: "CC", name: "Course Completion Certificate", category: "ACADEMIC_RECORDS",
    description: "States that you completed the course.", statuses: PASSED_OUT, purposes: GENERAL_PURPOSES, allowOtherPurpose: true,
    flow: [HOD_STEP, EXAM_STEP, PRINCIPAL_STEP],
    issuerFields: [f("completionMonth", "Month and year of completion (e.g. May 2026)")],
    template: { kind: "LETTER", title: "COURSE COMPLETION CERTIFICATE", body: `${STUDENT_LINE} has successfully completed {{course}} ({{branch}}), batch {{batch}}, under regulation {{regulation}}, in {{completionMonth}}, with a CGPA of {{cgpa}}.\n\n${REQUEST_LINE}` },
  },
  {
    key: "PROVISIONAL", code: "PC", name: "Provisional Certificate", category: "EXAMINATION",
    description: "Issued by the Exam Cell after you pass the course, until the degree is awarded.", statuses: PASSED_OUT, onceOnly: true, feeAmount: 500,
    flow: [EXAM_STEP], issuer: role("EXAM_CELL"),
    template: { kind: "UPLOAD", title: "PROVISIONAL CERTIFICATE" },
  },
  {
    key: "DEGREE", code: "DEG", name: "Degree Certificate", category: "EXAMINATION",
    description: "Your degree certificate, as received from the university.", statuses: PASSED_OUT, onceOnly: true, delivery: "PHYSICAL",
    flow: [EXAM_STEP, PRINCIPAL_STEP], issuer: role("EXAM_CELL"),
    template: { kind: "UPLOAD", title: "DEGREE CERTIFICATE" },
  },
  {
    key: "CMM", code: "CMM", name: "Consolidated Marks Memo (CMM)", category: "EXAMINATION",
    description: "All semesters' SGPA and your CGPA, from published results.", statuses: PASSED_OUT, feeAmount: 500,
    flow: [EXAM_STEP], issuer: role("EXAM_CELL"),
    template: { kind: "MARKS", title: "CONSOLIDATED MARKS MEMO", marksKind: "CONSOLIDATED", body: "Name: {{studentName}}    Regd. No: {{rollNumber}}\nCourse: {{course}} ({{branch}})    Regulation: {{regulation}}    Batch: {{batch}}" },
  },
  {
    key: "SEMESTER_MEMO", code: "SMM", name: "Semester Marks Memo", category: "EXAMINATION",
    description: "Grades of one semester, from published results.",
    fields: [f("semester", "Semester (1, 2, 3 ...)", "number")],
    flow: [EXAM_STEP], issuer: role("EXAM_CELL"),
    template: { kind: "MARKS", title: "SEMESTER MARKS MEMO", marksKind: "SEMESTER", body: "Name: {{studentName}}    Regd. No: {{rollNumber}}\nCourse: {{course}} ({{branch}})    Regulation: {{regulation}}    Semester: {{semester}}" },
  },
  {
    key: "DUPLICATE_MEMO", code: "DMM", name: "Duplicate Marks Memo", category: "EXAMINATION",
    description: "A duplicate of a lost or damaged marks memo.", feeAmount: 1000,
    fields: [f("semester", "Semester (1, 2, 3 ...)", "number"), f("reason", "Why a duplicate is needed", "select", true, { options: ["Lost", "Damaged"] })],
    attachments: [{ key: "affidavit", label: "Police report / affidavit", required: true }],
    flow: [EXAM_STEP, PRINCIPAL_STEP], issuer: role("EXAM_CELL"),
    template: { kind: "MARKS", title: "DUPLICATE SEMESTER MARKS MEMO", marksKind: "SEMESTER", body: "Name: {{studentName}}    Regd. No: {{rollNumber}}\nCourse: {{course}} ({{branch}})    Regulation: {{regulation}}    Semester: {{semester}}", footer: "DUPLICATE - issued in place of the original memo ({{reason}})." },
  },
  {
    key: "TRANSCRIPT", code: "TRN", name: "Transcript", category: "EXAMINATION",
    description: "Every semester's subjects and grades, for higher studies abroad.", feeAmount: 1000,
    purposes: ["Higher studies abroad", "Employment abroad", "WES / credential evaluation"], allowOtherPurpose: true,
    fields: [f("copies", "Number of copies", "number"), f("sendTo", "University / agency it is sent to", "text", false)],
    flow: [EXAM_STEP, PRINCIPAL_STEP], issuer: role("EXAM_CELL"),
    template: { kind: "MARKS", title: "TRANSCRIPT", marksKind: "TRANSCRIPT", body: "Name: {{studentName}}    Regd. No: {{rollNumber}}    Date of birth: {{dateOfBirth}}\nCourse: {{course}} ({{branch}})    Regulation: {{regulation}}    Batch: {{batch}}" },
  },
  {
    key: "MOI", code: "MOI", name: "Medium of Instruction (MOI) Certificate", category: "ACADEMIC_RECORDS",
    description: "States that teaching and exams were in English.", purposes: ["Higher studies abroad", "Visa", "Employment"], allowOtherPurpose: true,
    flow: [PRINCIPAL_STEP],
    template: { kind: "LETTER", title: "MEDIUM OF INSTRUCTION CERTIFICATE", body: `${STUDENT_LINE} {{studentStatus}} {{course}} ({{branch}}) in this college. The medium of instruction and examination for the entire course is ENGLISH.\n\n${REQUEST_LINE}` },
  },
  {
    // The college's own No Dues form: every department at once (dues / approval / result), then the Principal.
    // Started by the College Office for a whole batch; a department that doesn't apply marks Not applicable.
    key: "NO_DUES", code: "ND", name: "No Dues Certificate", category: "CLEARANCE",
    description: "Every department confirms the student has nothing pending.", startedBy: "OFFICE",
    flow: [
      {
        id: "clearances", type: "PARALLEL", label: "Department clearances",
        branches: [
          { key: "COLLEGE", label: "College", recipient: role("COLLEGE_OFFICE"), check: "DUES" },
          { key: "DEPARTMENT", label: "Department", recipient: HOD, check: "APPROVAL" },
          { key: "LIBRARY", label: "Library", recipient: role("LIBRARY"), check: "DUES" },
          { key: "HOSTEL_ACCOUNTS", label: "Hostel Accounts", recipient: role("HOSTEL"), check: "DUES" },
          { key: "ADMINISTRATION", label: "Administration", recipient: role("COLLEGE_OFFICE"), check: "DUES" },
          { key: "CANTEEN", label: "Canteen", recipient: role("COLLEGE_OFFICE"), check: "DUES" },
          { key: "BANK_LOAN", label: "Bank Loan", recipient: role("COLLEGE_OFFICE"), check: "DUES" },
          { key: "COLLEGE_ACCOUNTS", label: "College Accounts", recipient: role("COLLEGE_ACCOUNTS"), check: "DUES" },
          { key: "SCHOLARSHIPS", label: "Scholarships", recipient: role("COLLEGE_OFFICE"), check: "DUES" },
          { key: "EXAM_CELL", label: "Exam Cell", recipient: role("EXAM_CELL"), check: "RESULT" },
          { key: "PHYSICAL_EDUCATION", label: "Physical Education", recipient: role("PD"), check: "DUES" },
          { key: "WARDEN", label: "Warden", recipient: role("HOSTEL"), check: "APPROVAL" },
        ],
      },
      PRINCIPAL_STEP,
    ],
    template: {
      kind: "FORM", title: "NO DUES CERTIFICATE", showClearances: true,
      rows: [
        { label: "Name", value: "{{studentName}}" }, { label: "Father's Name", value: "{{fatherName}}" },
        { label: "Regd. No", value: "{{rollNumber}}" }, { label: "College", value: "{{collegeName}}" },
        { label: "Year / Semester", value: "{{year}} / {{semester}}" }, { label: "Branch", value: "{{branch}}" },
      ],
      footer: "The above student has \"NO DUES\" with the departments listed.",
    },
  },
  {
    key: "ATTENDANCE", code: "ATT", name: "Attendance Certificate", category: "ACADEMIC_RECORDS",
    description: "States your attendance for a period.", statuses: STUDYING, purposes: ["Scholarship", "Hostel", "Parents' office", "Government scheme"], allowOtherPurpose: true,
    fields: [f("period", "For which period (e.g. 2025-26, Semester V)")],
    flow: [HOD_STEP],
    issuerFields: [f("attendancePercentage", "Attendance %", "number")],
    template: { kind: "LETTER", title: "ATTENDANCE CERTIFICATE", body: `${STUDENT_LINE} studying {{year}} year {{course}} ({{branch}}), section {{section}}, has an attendance of {{attendancePercentage}}% for {{period}}.\n\n${REQUEST_LINE}` },
  },
  {
    key: "INTERNSHIP", code: "INT", name: "Internship / Training Letter", category: "LETTERS",
    description: "Asks an organisation to allow you an internship or training.", statuses: STUDYING,
    fields: [f("organisation", "Organisation name and place"), f("fromDate", "From", "date"), f("toDate", "To", "date"), f("addressedTo", "Addressed to (e.g. The HR Manager)", "text", false)],
    flow: [MENTOR_STEP, HOD_STEP, PRINCIPAL_STEP],
    template: { kind: "LETTER", title: "INTERNSHIP / TRAINING LETTER", body: `To\n{{addressedTo}}\n{{organisation}}\n\n${STUDENT_LINE} ${STUDYING_LINE}\n\nWe request you to permit {{himHer}} to undergo internship / training in your organisation from {{fromDate}} to {{toDate}}. The college has no objection to {{hisHer}} taking up the internship during this period.` },
  },
  {
    key: "NOC", code: "NOC", name: "No Objection Certificate (NOC)", category: "LETTERS",
    description: "The college has no objection to the activity you name.", statuses: STUDYING,
    fields: [f("activity", "For what (e.g. a hackathon at IIT Madras, a part-time course)", "textarea"), f("organisation", "Organisation", "text", false)],
    flow: [HOD_STEP, PRINCIPAL_STEP],
    template: { kind: "LETTER", title: "NO OBJECTION CERTIFICATE", body: `${STUDENT_LINE} ${STUDYING_LINE}\n\nThe college has no objection to {{hisHer}} {{activity}}.` },
  },
  {
    key: "RECOMMENDATION", code: "LOR", name: "Recommendation / Verification Letter", category: "LETTERS",
    description: "A letter of recommendation from your department.", purposes: ["Higher studies", "Employment", "Internship"], allowOtherPurpose: true,
    fields: [f("addressedTo", "Addressed to (university / company)"), f("highlights", "Achievements to mention", "textarea", false)],
    flow: [MENTOR_STEP, HOD_STEP, PRINCIPAL_STEP],
    issuerFields: [f("recommendation", "Recommendation text", "textarea")],
    template: { kind: "LETTER", title: "LETTER OF RECOMMENDATION", body: `To\n{{addressedTo}}\n\n${STUDENT_LINE} {{studentStatus}} {{course}} ({{branch}}) in this college.\n\n{{recommendation}}\n\nWe recommend {{himHer}} for {{purpose}}.` },
  },
  {
    key: "BONAFIDE_PASSPORT", code: "BPV", name: "Bonafide for Passport / Visa", category: "IDENTITY",
    description: "Bonafide certificate for a passport or visa application.", statuses: STUDYING, purposes: ["Passport", "Visa"],
    fields: [f("country", "Country (visa only)", "text", false)],
    flow: [HOD_STEP, PRINCIPAL_STEP],
    template: { kind: "LETTER", title: "BONAFIDE CERTIFICATE", body: `${STUDENT_LINE} born on {{dateOfBirth}}, ${STUDYING_LINE}\n\n{{hisHer}} permanent address as per college records is {{permanentAddress}}.\n\n${REQUEST_LINE}` },
  },
  {
    key: "BONAFIDE_LOAN", code: "BEL", name: "Bonafide for Bank / Education Loan", category: "FEE_FINANCE",
    description: "Bonafide with the course fee, for an education loan.", statuses: STUDYING, purposes: ["Education loan", "Bank account"],
    fields: [f("bankName", "Bank name and branch")],
    flow: [HOD_STEP, ACCOUNTS_STEP, PRINCIPAL_STEP],
    issuerFields: [f("feeDetails", "Fee per year (tuition, hostel, exam ...)", "textarea")],
    template: { kind: "LETTER", title: "BONAFIDE CERTIFICATE (EDUCATION LOAN)", body: `To\nThe Manager\n{{bankName}}\n\n${STUDENT_LINE} ${STUDYING_LINE}\n\nThe fee payable for the course is as follows:\n{{feeDetails}}\n\n${REQUEST_LINE}` },
  },
  {
    key: "BONAFIDE_SCHOLARSHIP", code: "BSC", name: "Bonafide for Scholarship", category: "FEE_FINANCE",
    description: "Bonafide certificate for a scholarship application.", statuses: STUDYING, purposes: ["Scholarship"],
    fields: [f("scholarshipName", "Scholarship name")],
    flow: [HOD_STEP, PRINCIPAL_STEP],
    template: { kind: "LETTER", title: "BONAFIDE CERTIFICATE (SCHOLARSHIP)", body: `${STUDENT_LINE} ${STUDYING_LINE}\n\nThis certificate is issued at {{hisHer}} request for applying to the {{scholarshipName}}.` },
  },
  {
    key: "GOVT_SCHEME", code: "GS", name: "Certificate for Government Schemes", category: "FEE_FINANCE",
    description: "For a government scheme (fee reimbursement, laptop, travel pass ...).", statuses: STUDYING,
    fields: [f("schemeName", "Scheme name")],
    flow: [HOD_STEP, PRINCIPAL_STEP],
    template: { kind: "LETTER", title: "CERTIFICATE", body: `${STUDENT_LINE} ${STUDYING_LINE}\n\nThis certificate is issued at {{hisHer}} request for availing the {{schemeName}}.` },
  },
  {
    key: "FEE_PAYMENT", code: "FEE", name: "Fee Payment Certificate", category: "FEE_FINANCE",
    description: "States the fee you paid for an academic year (income tax, reimbursement).", purposes: ["Income tax", "Reimbursement", "Education loan"], allowOtherPurpose: true,
    fields: [f("feeYear", "Academic year (e.g. 2025-26)")],
    flow: [ACCOUNTS_STEP],
    issuerFields: [f("amountPaid", "Amount paid (Rs.)", "number"), f("paymentDetails", "Receipt numbers and dates", "textarea", false)],
    template: { kind: "LETTER", title: "FEE PAYMENT CERTIFICATE", body: `${STUDENT_LINE} studying {{course}} ({{branch}}), has paid a fee of Rs. {{amountPaid}} for the academic year {{feeYear}}.\n\n{{paymentDetails}}\n\n${REQUEST_LINE}` },
  },
  {
    key: "FEE_CONCESSION", code: "FCN", name: "Scholarship / Fee Concession Certificate", category: "FEE_FINANCE",
    description: "States a scholarship or fee concession you received.", purposes: ["Income tax", "Scholarship renewal", "Bank"], allowOtherPurpose: true,
    fields: [f("feeYear", "Academic year (e.g. 2025-26)")],
    flow: [ACCOUNTS_STEP, PRINCIPAL_STEP],
    issuerFields: [f("concessionDetails", "Scholarship / concession and amount", "textarea")],
    template: { kind: "LETTER", title: "SCHOLARSHIP / FEE CONCESSION CERTIFICATE", body: `${STUDENT_LINE} studying {{course}} ({{branch}}), has received the following for the academic year {{feeYear}}:\n\n{{concessionDetails}}\n\n${REQUEST_LINE}` },
  },
  {
    key: "RANK", code: "RNK", name: "Rank / Merit Certificate", category: "EXAMINATION",
    description: "States your rank or merit position.", purposes: GENERAL_PURPOSES, allowOtherPurpose: true,
    flow: [EXAM_STEP, PRINCIPAL_STEP],
    issuerFields: [f("rank", "Rank / position"), f("rankBasis", "Basis (e.g. CGPA up to Semester VI, in the branch)")],
    template: { kind: "LETTER", title: "RANK CERTIFICATE", body: `${STUDENT_LINE} {{studentStatus}} {{course}} ({{branch}}), batch {{batch}}, has secured rank {{rank}} on the basis of {{rankBasis}}, with a CGPA of {{cgpa}}.\n\n${REQUEST_LINE}` },
  },
  {
    key: "PROGRAM_VERIFICATION", code: "PVL", name: "Course / Program Verification Letter", category: "LETTERS",
    description: "Confirms your course, branch and dates to an employer or university.", purposes: ["Employment background check", "Higher studies"], allowOtherPurpose: true,
    fields: [f("addressedTo", "Organisation asking for it")],
    flow: [EXAM_STEP, PRINCIPAL_STEP],
    issuerFields: [f("studyPeriod", "Period of study (e.g. 2022-2026)")],
    template: { kind: "LETTER", title: "VERIFICATION LETTER", body: `To\n{{addressedTo}}\n\n${STUDENT_LINE} {{studentStatus}} {{course}} ({{branch}}), regulation {{regulation}}, in this college during {{studyPeriod}}. {{hisHer}} CGPA as per the published results is {{cgpa}}.\n\nThis letter is issued for the purpose of {{purpose}}.` },
  },
];

export const CATALOG_TEMPLATE_ID = (key: string) => `tpl_${key.toLowerCase()}`;
export const CATALOG_TYPE_ID = (key: string) => key.toLowerCase();

export interface CatalogItem {
  type: Omit<CertificateTypeConfig, "id" | "updatedAt" | "updatedByName">;
  typeId: string;
  template: Omit<CertificateTemplate, "id" | "updatedAt">;
  templateId: string;
}

/** The starter catalogue, ready to store (types reference their template by id). */
export function starterCatalog(): CatalogItem[] {
  return ENTRIES.map((e) => {
    const templateId = CATALOG_TEMPLATE_ID(e.key);
    return {
      typeId: CATALOG_TYPE_ID(e.key),
      templateId,
      template: {
        name: e.name, kind: e.template.kind, title: e.template.title, showQr: e.template.showQr ?? true, catalogKey: e.key,
        ...(e.template.body ? { body: e.template.body } : {}), ...(e.template.rows ? { rows: e.template.rows } : {}),
        ...(e.template.marksKind ? { marksKind: e.template.marksKind } : {}), ...(e.template.footer ? { footer: e.template.footer } : {}),
        ...(e.template.showClearances ? { showClearances: true } : {}),
      },
      type: {
        code: e.code, name: e.name, category: e.category, description: e.description,
        isActive: e.key === "NO_DUES",
        eligibility: { statuses: e.statuses ?? [], years: [] },
        purposes: e.purposes ?? [], allowOtherPurpose: e.allowOtherPurpose ?? false,
        fields: e.fields ?? [], attachments: e.attachments ?? [], onceOnly: e.onceOnly ?? false, feeAmount: e.feeAmount ?? 0,
        flow: e.flow, issuer: e.issuer ?? role("COLLEGE_OFFICE"), templateId, issuerFields: e.issuerFields ?? [],
        numberFormat: "{CODE}/{YYYY}/{SEQ}", delivery: e.delivery ?? "BOTH", catalogKey: e.key, startedBy: e.startedBy ?? "STUDENT",
      },
    };
  });
}
