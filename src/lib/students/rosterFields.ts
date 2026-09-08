import { CASTE_OPTIONS } from "@/lib/import/fieldConstraints";
import type { StudentRecord } from "@/types";

// The student roster's fields, in the exact order and wording of the CSV
// import template - one definition shared by everything that presents them:
// the importer's column list, the Office students page's detail view, and its
// Add/Edit forms.
//
// Kept in one place because those four had no way to stay in step otherwise:
// the importer already collected all 35 columns while the Add form asked for
// 7 of them, so a manually-added student silently carried less than an
// imported one. Adding a column here now flows to every surface at once.
//
// `sample` is a per-column RULE/INSTRUCTION string (e.g. "Required; full
// student name", "Optional: Male / Female / Other") - not literal example
// data - matching src/lib/faculty/csvColumns.ts's IMPORT_COLUMNS convention.
// It becomes the Template sheet's row 2 in the downloaded workbook. Literal
// example values live separately in ROSTER_SAMPLE_ROWS below, for the
// workbook's "Sample Data" sheet.

export type RosterFieldKind = "text" | "date" | "number" | "yesno" | "select";

export interface RosterField {
  /** Key on StudentRecord, or "sno" for the sheet-only serial column. */
  key: string;
  /** Exact CSV header - also the form label and detail-view caption. */
  label: string;
  kind: RosterFieldKind;
  /** For kind "select". */
  options?: string[];
  /** Alternate CSV headers accepted on import. */
  aliases?: string[];
  /** Sample cell in the downloaded template. */
  sample?: string;
  /** Required by the importer (and by the Add form). */
  required?: boolean;
  /**
   * The identity fields - shown first, before the rest of the admission
   * detail. These are what a roster row is recognised by.
   */
  primary?: boolean;
  /**
   * A convenience column for the sheet's author that isn't stored on the
   * student (the row's serial number). Skipped by the forms and detail view.
   */
  sheetOnly?: boolean;
  /** Placeholder for the Add/Edit form input. */
  placeholder?: string;
  /**
   * Kept out of the students list's columns while still belonging to the
   * identity block of the form and detail view - for a field that's only
   * ever set for a small subset of students, so most rows would show a
   * near-empty column.
   */
  hideInList?: boolean;
}

export const ROSTER_FIELDS: RosterField[] = [
  { key: "sno", label: "S.No", kind: "text", sample: "Sheet-only; serial number, not stored", primary: true, sheetOnly: true },
  { key: "name", label: "Name (as per SSC)", kind: "text", sample: "Required; full name exactly as on SSC (10th) certificate", required: true, primary: true, aliases: ["Name", "Student Name", "Full Name"], placeholder: "P. Sai Kumar" },
  { key: "studentType", label: "Student Type", kind: "select", sample: "Optional: Regular / Lateral - defaults to Regular when left blank", primary: true, options: ["Regular", "Lateral"] },
  { key: "course", label: "Course", kind: "text", sample: "Required; the programme (e.g. Bachelor of Technology) or its short Code - must be a course the row's Department actually offers", required: true, primary: true, aliases: ["Programme", "Program"], placeholder: "B.Tech" },
  { key: "department", label: "Department", kind: "select", sample: "Required; full AICTE department name (e.g. \"Computer Science and Engineering\", not \"CSE\") or the short Code, as added on your college", required: true, primary: true, aliases: ["Dept", "Department Code", "Branch"] },
  { key: "secondaryDepartment", label: "Core Department", kind: "select", sample: "Optional; same name/Code rules as Department - only for a 1st-year pre-registered to a core branch while enrolled under a shared/Basic Science department", primary: true,
    aliases: ["Secondary Department", "Secondary Dept", "Core Branch"] },
  { key: "year", label: "Academic Year", kind: "select", sample: "Required; the academic year number (1-4)", required: true, primary: true, aliases: ["Year"] },
  { key: "semester", label: "Semester", kind: "text", sample: "Optional; e.g. \"1\" or \"1st Semester\"", primary: true, aliases: ["Sem"], placeholder: "1st Semester" },
  { key: "rollNumber", label: "Roll No", kind: "text", sample: "Optional; a provisional roll number if you already have one - not checked for uniqueness until the department assigns the real one", primary: true, aliases: ["Roll Number"] },

  { key: "admissionNo", label: "Admission No", kind: "text", sample: "Optional; text" },
  { key: "hallTicketNo", label: "Hall Ticket No", kind: "text", sample: "Optional; text" },
  { key: "dateOfAdmission", label: "Date of Admission (YYYY-MM-DD)", kind: "date", sample: "Optional; YYYY-MM-DD" },
  { key: "admissionType", label: "Admission Type", kind: "text", sample: "Optional; e.g. Direct, Management, Convenor", placeholder: "Direct" },
  { key: "entranceType", label: "Entrance Type", kind: "text", sample: "Optional; e.g. EAMCET, ECET, JEE", placeholder: "EAMCET" },
  { key: "entranceRank", label: "Entrance Rank", kind: "text", sample: "Optional; text/number" },
  { key: "jeeRank", label: "JEE Rank", kind: "text", sample: "Optional; text/number" },
  { key: "jeePercentage", label: "JEE %", kind: "text", sample: "Optional; number, e.g. 95.5" },
  { key: "seatType", label: "Seat Type", kind: "text", sample: "Optional; e.g. Convenor, Management", placeholder: "Convenor" },
  { key: "scholarship", label: "Scholarship (Yes/No)", kind: "yesno", sample: "Optional: Yes / No" },
  { key: "gender", label: "Gender", kind: "select", sample: "Optional: Male / Female / Other", options: ["Male", "Female", "Other"] },
  { key: "dateOfBirth", label: "Date of Birth (YYYY-MM-DD)", kind: "date", sample: "Optional; YYYY-MM-DD", aliases: ["DOB", "Date of Birth"] },
  { key: "bloodGroup", label: "Blood Group", kind: "text", sample: "Optional: A+ / A- / B+ / B- / AB+ / AB- / O+ / O-", placeholder: "O+" },
  { key: "caste", label: "Caste", kind: "select", sample: `Optional: ${CASTE_OPTIONS.join(" / ")}`, options: [...CASTE_OPTIONS] },
  { key: "subCaste", label: "Sub Caste", kind: "text", sample: "Optional; text" },
  { key: "religion", label: "Religion", kind: "text", sample: "Optional; e.g. Hindu, Muslim, Christian, Sikh, Jain, Parsi, Buddhist, Other" },
  { key: "nationality", label: "Nationality", kind: "text", sample: "Optional; text", placeholder: "Indian" },
  { key: "motherTongue", label: "Mother Tongue", kind: "text", sample: "Optional; text" },
  { key: "guardianContact", label: "Guardian Contact", kind: "text", sample: "Optional; phone/text", aliases: ["Parent Contact", "Guardian Phone", "Parent Phone"], placeholder: "9876543210" },
  { key: "mobileNo", label: "Student Mobile No", kind: "text", sample: "Optional; phone/text" },
  { key: "landLineNo", label: "Land Line No", kind: "text", sample: "Optional; text" },
  { key: "email", label: "Email", kind: "text", sample: "Optional; must contain @", aliases: ["Email ID"], placeholder: "student@example.com" },
  { key: "aadharNo", label: "Aadhar Card No.", kind: "text", sample: "Optional; text", aliases: ["Aadhar No"] },
  { key: "rationCardNo", label: "Ration Card No", kind: "text", sample: "Optional; text" },
  { key: "bankAccountNo", label: "Student Bank A/C No.", kind: "text", sample: "Optional; text" },
  { key: "lastAttendedInstitution", label: "Last Attended Institution", kind: "text", sample: "Optional; text" },
  { key: "distanceFromResidenceKm", label: "Distance From Res. To College (km)", kind: "number", sample: "Optional; number" },
  { key: "hosteller", label: "Hosteller (Yes/No)", kind: "yesno", sample: "Optional: Yes / No" },
  { key: "physicallyHandicapped", label: "Physically Handicapped (Yes/No)", kind: "yesno", sample: "Optional: Yes / No" },
  { key: "handicappedType", label: "If Yes (Handicapped) - H/V/O", kind: "select", sample: "Optional (only if Physically Handicapped is Yes): H (Hearing) / V (Visual) / O (Other)", options: ["H", "V", "O"] },
  { key: "identificationMarks", label: "Identification Marks", kind: "text", sample: "Optional; text" },
  { key: "remarks", label: "Remarks", kind: "text", sample: "Optional; text" },
];

// Five filled-in rows for the template workbook's second ("Sample Data")
// sheet - what a correctly-completed row looks like for every column, which
// the Template sheet's instruction row (built from each field's `sample`
// above) can only describe. Keyed by field key rather than written as a
// positional array so adding or reordering a column can't silently shift the
// data under the wrong headers - same rationale as Faculty's own
// IMPORT_SAMPLE_ROWS (src/lib/faculty/csvColumns.ts).
export const ROSTER_SAMPLE_ROWS: Record<string, string>[] = [
  {
    sno: "1", name: "P. Sai Kumar", studentType: "Regular", course: "Bachelor of Technology", department: "Computer Science and Engineering",
    secondaryDepartment: "", year: "2", semester: "3", rollNumber: "22A91A0501",
    admissionNo: "ADM2022001", hallTicketNo: "1234567890", dateOfAdmission: "2022-06-01",
    admissionType: "Convenor", entranceType: "EAMCET", entranceRank: "4521", jeeRank: "", jeePercentage: "",
    seatType: "Convenor", scholarship: "No", gender: "Male", dateOfBirth: "2004-08-12", bloodGroup: "O+",
    caste: "OC", subCaste: "", religion: "Hindu", nationality: "Indian", motherTongue: "Telugu",
    guardianContact: "9876543210", mobileNo: "9876543211", landLineNo: "",
    email: "saikumar@gmail.com", aadharNo: "123456789012", rationCardNo: "", bankAccountNo: "62345671234",
    lastAttendedInstitution: "Sri Chaitanya Junior College", distanceFromResidenceKm: "12",
    hosteller: "No", physicallyHandicapped: "No", handicappedType: "", identificationMarks: "Mole on left cheek", remarks: "",
  },
  {
    sno: "2", name: "K. Divya Sree", studentType: "Regular", course: "Bachelor of Technology", department: "Information Technology",
    secondaryDepartment: "", year: "1", semester: "1", rollNumber: "",
    admissionNo: "ADM2026014", hallTicketNo: "2345678901", dateOfAdmission: "2026-06-01",
    admissionType: "Management", entranceType: "JEE", entranceRank: "", jeeRank: "18452", jeePercentage: "95.5",
    seatType: "Management", scholarship: "Yes", gender: "Female", dateOfBirth: "2008-01-30", bloodGroup: "B+",
    caste: "BC", subCaste: "BC-B", religion: "Hindu", nationality: "Indian", motherTongue: "Telugu",
    guardianContact: "9876543212", mobileNo: "9876543213", landLineNo: "08832451234",
    email: "divyasree.k@gmail.com", aadharNo: "234567890123", rationCardNo: "RC1234567", bankAccountNo: "62345672345",
    lastAttendedInstitution: "Narayana Junior College", distanceFromResidenceKm: "5.5",
    hosteller: "Yes", physicallyHandicapped: "No", handicappedType: "", identificationMarks: "", remarks: "Hostel room 214",
  },
  {
    sno: "3", name: "M. Rahul Varma", studentType: "Regular", course: "Bachelor of Technology", department: "Basic Science",
    secondaryDepartment: "Electronics and Communication Engineering", year: "1", semester: "1", rollNumber: "",
    admissionNo: "ADM2026028", hallTicketNo: "3456789012", dateOfAdmission: "2026-06-01",
    admissionType: "Direct", entranceType: "ECET", entranceRank: "902", jeeRank: "", jeePercentage: "",
    seatType: "Convenor", scholarship: "No", gender: "Male", dateOfBirth: "2008-03-19", bloodGroup: "A+",
    caste: "EBC", subCaste: "", religion: "Muslim", nationality: "Indian", motherTongue: "Urdu",
    guardianContact: "9876543214", mobileNo: "", landLineNo: "",
    email: "", aadharNo: "", rationCardNo: "", bankAccountNo: "",
    lastAttendedInstitution: "", distanceFromResidenceKm: "",
    hosteller: "No", physicallyHandicapped: "No", handicappedType: "", identificationMarks: "", remarks: "",
  },
  {
    sno: "4", name: "S. Anjali", studentType: "Lateral", course: "Bachelor of Technology", department: "Electronics and Communication Engineering",
    secondaryDepartment: "", year: "3", semester: "5", rollNumber: "24A91A0442",
    admissionNo: "ADM2024037", hallTicketNo: "4567890123", dateOfAdmission: "2024-06-03",
    admissionType: "Convenor", entranceType: "EAMCET", entranceRank: "11023", jeeRank: "", jeePercentage: "",
    seatType: "Convenor", scholarship: "Yes", gender: "Female", dateOfBirth: "2006-11-05", bloodGroup: "AB+",
    caste: "SC", subCaste: "Mala", religion: "Christian", nationality: "Indian", motherTongue: "Telugu",
    guardianContact: "9876543216", mobileNo: "9876543217", landLineNo: "",
    email: "anjali.s@gmail.com", aadharNo: "456789012345", rationCardNo: "", bankAccountNo: "62345674567",
    lastAttendedInstitution: "Sri Gayatri Junior College", distanceFromResidenceKm: "20",
    hosteller: "Yes", physicallyHandicapped: "Yes", handicappedType: "H", identificationMarks: "", remarks: "Needs front-row seating",
  },
  {
    sno: "5", name: "T. Bhargav", studentType: "Regular", course: "Bachelor of Technology", department: "Mechanical Engineering",
    secondaryDepartment: "", year: "4", semester: "7", rollNumber: "23A91A0318",
    admissionNo: "ADM2023052", hallTicketNo: "5678901234", dateOfAdmission: "2023-06-05",
    admissionType: "Convenor", entranceType: "EAMCET", entranceRank: "7788", jeeRank: "", jeePercentage: "",
    seatType: "Convenor", scholarship: "No", gender: "Male", dateOfBirth: "2005-05-27", bloodGroup: "O-",
    caste: "ST", subCaste: "Koya", religion: "Hindu", nationality: "Indian", motherTongue: "Telugu",
    guardianContact: "9876543218", mobileNo: "9876543219", landLineNo: "",
    email: "bhargav.t@gmail.com", aadharNo: "567890123456", rationCardNo: "RC7654321", bankAccountNo: "62345675678",
    lastAttendedInstitution: "Vignan Junior College", distanceFromResidenceKm: "8",
    hosteller: "No", physicallyHandicapped: "No", handicappedType: "", identificationMarks: "", remarks: "",
  },
];

/** The identity fields, in template order - shown before everything else. */
export const PRIMARY_ROSTER_FIELDS = ROSTER_FIELDS.filter((f) => f.primary && !f.sheetOnly);

/** The identity fields the students list shows as columns. */
export const LIST_ROSTER_FIELDS = PRIMARY_ROSTER_FIELDS.filter((f) => !f.hideInList);

/** Everything after the identity block, in template order. */
export const DETAIL_ROSTER_FIELDS = ROSTER_FIELDS.filter((f) => !f.primary && !f.sheetOnly);

/** Fields the Add/Edit forms collect - every stored one, template order. */
export const EDITABLE_ROSTER_FIELDS = ROSTER_FIELDS.filter((f) => !f.sheetOnly);

/**
 * The roster keys a student's *details* live under - everything the forms
 * collect except the three the students API resolves itself (name, and the
 * department/year that decide ownership and scope). Template order.
 */
export const ROSTER_DETAIL_KEYS = EDITABLE_ROSTER_FIELDS
  .filter((f) => !["name", "department", "year"].includes(f.key))
  .map((f) => f.key);

const ROSTER_FIELD_BY_KEY = new Map(ROSTER_FIELDS.map((f) => [f.key, f]));

/**
 * Server-side counterpart of rosterFormToPayload: takes a request body and
 * returns only the roster detail fields, coerced and cleaned the same way the
 * CSV importer's buildStudentDoc cleans a parsed row - strings trimmed, email
 * lower-cased, Yes/No accepted as either boolean or string, blanks dropped
 * rather than stored as empty.
 *
 * Shared by the students POST and PATCH so a student added or edited by hand
 * ends up with the same document shape as an imported one; before this, POST
 * hand-wrote four of these fields and ignored the other 28.
 */
export function normalizeRosterDetails(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ROSTER_DETAIL_KEYS) {
    if (!(key in input)) continue;
    const field = ROSTER_FIELD_BY_KEY.get(key);
    const raw = input[key];
    // An explicit null (only ever sent by the Edit form's
    // writeBlanksAsNull - see rosterFormToPayload) means the user actively
    // cleared this field - write it through as a real clear, distinct from
    // the key being absent altogether (nothing to change).
    if (raw === null) { out[key] = null; continue; }
    if (raw === undefined) continue;

    if (field?.kind === "yesno") {
      if (typeof raw === "boolean") { out[key] = raw; continue; }
      const t = String(raw).trim().toUpperCase();
      if (t === "YES" || t === "Y" || t === "TRUE") out[key] = true;
      else if (t === "NO" || t === "N" || t === "FALSE") out[key] = false;
      continue;
    }

    if (field?.kind === "number" || key === "semester") {
      const m = typeof raw === "number" ? raw : Number(String(raw).match(/\d+(\.\d+)?/)?.[0]);
      if (Number.isFinite(m)) out[key] = m;
      continue;
    }

    if (key === "handicappedType") {
      const t = String(raw).trim().toUpperCase();
      if (t === "H" || t === "V" || t === "O") out[key] = t;
      continue;
    }

    const s = String(raw).trim();
    if (!s) continue;
    out[key] = key === "email" ? s.toLowerCase() : s;
  }
  return out;
}

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/**
 * A field's value on a student, rendered for display. Returns "" when unset so
 * callers can decide how to show a blank (the detail view uses an em dash).
 */
export function rosterFieldDisplay(field: RosterField, student: Partial<StudentRecord>): string {
  const raw = (student as Record<string, unknown>)[field.key];
  if (raw === undefined || raw === null || raw === "") return "";
  if (field.kind === "yesno") return raw ? "Yes" : "No";
  if (field.key === "year" && typeof raw === "number") return ordinalYear(raw);
  if (field.key === "semester" && typeof raw === "number") return `Semester ${raw}`;
  return String(raw);
}

/**
 * A field's value as a form input string. Booleans become "Yes"/"No" to match
 * the select options; numbers stringify; anything unset is "".
 */
export function rosterFieldFormValue(field: RosterField, student: Partial<StudentRecord>): string {
  const raw = (student as Record<string, unknown>)[field.key];
  if (raw === undefined || raw === null) return "";
  if (field.kind === "yesno") return raw ? "Yes" : "No";
  return String(raw);
}

/**
 * Turns the form's all-strings state back into the typed payload the students
 * API expects - the same coercions the CSV importer applies (see importRow),
 * so a manual add and an imported row store identically shaped documents.
 * Blank values are omitted rather than written as empty.
 */
export function rosterFormToPayload(
  values: Record<string, string>,
  options?: { writeBlanksAsNull?: boolean }
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EDITABLE_ROSTER_FIELDS) {
    const v = (values[f.key] ?? "").trim();
    if (!v) {
      // On Add, a never-entered field is correctly omitted (nothing to
      // preserve). On Edit, the form is pre-filled from the student's
      // current values, so a blank here means the user actively cleared it
      // (e.g. Secondary Department back to "Not specified") - write an
      // explicit null so the update actually removes it, instead of the
      // omitted key leaving the old value untouched on the document.
      if (options?.writeBlanksAsNull) out[f.key] = null;
      continue;
    }
    if (f.kind === "yesno") {
      out[f.key] = v.toLowerCase() === "yes";
    } else if (f.kind === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.key === "year") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.key === "semester") {
      // "1st Semester", "Semester 1" and "1" all reduce to the same number,
      // matching the importer's parseSemester.
      const m = v.match(/\d+/);
      if (m) out[f.key] = Number(m[0]);
    } else if (f.key === "email") {
      out[f.key] = v.toLowerCase();
    } else {
      out[f.key] = v;
    }
  }
  return out;
}
