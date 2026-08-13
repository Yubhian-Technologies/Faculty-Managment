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
}

export const ROSTER_FIELDS: RosterField[] = [
  { key: "sno", label: "S.No", kind: "text", sample: "1", primary: true, sheetOnly: true },
  { key: "name", label: "Name", kind: "text", sample: "P. Sai Kumar", required: true, primary: true, aliases: ["Student Name", "Full Name"], placeholder: "P. Sai Kumar" },
  { key: "course", label: "Course", kind: "text", sample: "", primary: true, aliases: ["Programme", "Program"], placeholder: "B.Tech" },
  { key: "department", label: "Department", kind: "select", sample: "IT", required: true, primary: true, aliases: ["Dept", "Department Code", "Branch"] },
  { key: "year", label: "Academic Year", kind: "select", sample: "1", required: true, primary: true, aliases: ["Year"] },
  { key: "semester", label: "Semester", kind: "text", sample: "1st Semester", primary: true, aliases: ["Sem"], placeholder: "1st Semester" },
  { key: "rollNumber", label: "Roll No", kind: "text", sample: "", primary: true, aliases: ["Roll Number"] },

  { key: "admissionNo", label: "Admission No", kind: "text", sample: "" },
  { key: "hallTicketNo", label: "Hall Ticket No", kind: "text", sample: "" },
  { key: "dateOfAdmission", label: "Date of Admission (YYYY-MM-DD)", kind: "date", sample: "2026-06-01" },
  { key: "admissionType", label: "Admission Type", kind: "text", sample: "Direct", placeholder: "Direct" },
  { key: "entranceType", label: "Entrance Type", kind: "text", sample: "EAMCET", placeholder: "EAMCET" },
  { key: "entranceRank", label: "Entrance Rank", kind: "text", sample: "" },
  { key: "seatType", label: "Seat Type", kind: "text", sample: "Convenor", placeholder: "Convenor" },
  { key: "scholarship", label: "Scholarship (Yes/No)", kind: "yesno", sample: "No" },
  { key: "gender", label: "Gender", kind: "select", sample: "Male", options: ["Male", "Female", "Other"] },
  { key: "dateOfBirth", label: "Date of Birth (YYYY-MM-DD)", kind: "date", sample: "2004-08-12", aliases: ["DOB", "Date of Birth"] },
  { key: "bloodGroup", label: "Blood Group", kind: "text", sample: "O+", placeholder: "O+" },
  { key: "religion", label: "Religion", kind: "text", sample: "Hindu" },
  { key: "category", label: "Category", kind: "text", sample: "OC", placeholder: "OC / BC / SC / ST" },
  { key: "nationality", label: "Nationality", kind: "text", sample: "Indian", placeholder: "Indian" },
  { key: "motherTongue", label: "Mother Tongue", kind: "text", sample: "Telugu" },
  { key: "guardianContact", label: "Guardian Contact", kind: "text", sample: "9876543210", aliases: ["Parent Contact", "Guardian Phone", "Parent Phone"], placeholder: "9876543210" },
  { key: "mobileNo", label: "Student Mobile No", kind: "text", sample: "9876543210" },
  { key: "landLineNo", label: "Land Line No", kind: "text", sample: "" },
  { key: "email", label: "Email", kind: "text", sample: "sai@gmail.com", aliases: ["Email ID"], placeholder: "student@example.com" },
  { key: "aadharNo", label: "Aadhar Card No.", kind: "text", sample: "", aliases: ["Aadhar No"] },
  { key: "rationCardNo", label: "Ration Card No", kind: "text", sample: "" },
  { key: "bankAccountNo", label: "Student Bank A/C No.", kind: "text", sample: "" },
  { key: "lastAttendedInstitution", label: "Last Attended Institution", kind: "text", sample: "" },
  { key: "distanceFromResidenceKm", label: "Distance From Res. To College (km)", kind: "number", sample: "" },
  { key: "hosteller", label: "Hosteller (Yes/No)", kind: "yesno", sample: "No" },
  { key: "physicallyHandicapped", label: "Physically Handicapped (Yes/No)", kind: "yesno", sample: "No" },
  { key: "handicappedType", label: "If Yes (Handicapped) - H/V/O", kind: "select", sample: "", options: ["H", "V", "O"] },
  { key: "identificationMarks", label: "Identification Marks", kind: "text", sample: "" },
  { key: "remarks", label: "Remarks", kind: "text", sample: "" },
];

/** The identity fields, in template order - shown before everything else. */
export const PRIMARY_ROSTER_FIELDS = ROSTER_FIELDS.filter((f) => f.primary && !f.sheetOnly);

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
    if (raw === undefined || raw === null) continue;

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
export function rosterFormToPayload(values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EDITABLE_ROSTER_FIELDS) {
    const v = (values[f.key] ?? "").trim();
    if (!v) continue;
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
