import { normalizeStudentMobile } from "@/lib/students/studentMobile";
import { EMAIL_REGEX, PHONE_REGEX } from "@/lib/validations";
import { CATEGORY_OPTIONS } from "./recordSections";
import type {
  MentoringRecordProfile,
  QualifyingRow,
  RecordFieldKind,
  RecordFieldView,
  RecordProfileGroup,
} from "@/types/mentoring";

// Page 1 and 7.1 of the Student Mentoring Record, built from the student's own
// record. A value the student (or the College Office) already holds is shown as
// it is and is never overwritten here - the record has one source of truth. Only
// a value that is MISSING can be filled in by the mentor; it is kept apart, in
// students/{id}/mentoringProfile/record.overrides, and the student's own value
// wins the moment one exists. Pure.

type Source = Record<string, unknown>;

interface FieldDef {
  key: string;
  label: string;
  kind: RecordFieldKind;
  /** Key on the student record. Absent = a detail the roster has no column for (mentor-entered only). */
  rosterKey?: string;
  /** Used when the roster value is blank. */
  fallbackKeys?: string[];
  /** Never editable here (identity). */
  locked?: boolean;
}

const f = (key: string, label: string, kind: RecordFieldKind, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });

const GROUPS: { id: RecordProfileGroup["id"]; title: string; fields: FieldDef[] }[] = [
  {
    id: "student",
    title: "Student",
    fields: [
      f("name", "Name of the student", "text", { rosterKey: "name", locked: true }),
      f("rollNumber", "Regd. No.", "text", { rosterKey: "rollNumber", locked: true }),
      f("dateOfBirth", "Date of birth", "date", { rosterKey: "dateOfBirth" }),
      f("bloodGroup", "Blood group", "text", { rosterKey: "bloodGroup" }),
      f("mobileNo", "Mobile no", "phone", { rosterKey: "mobileNo" }),
      f("email", "E-mail", "email", { rosterKey: "email" }),
      f("gender", "Gender", "text", { rosterKey: "gender" }),
      f("nationality", "Nationality", "text", { rosterKey: "nationality" }),
      f("religion", "Religion", "text", { rosterKey: "religion" }),
      // Category (OC / OBC / SC / ST) follows from the roster's caste when it can; see categoryOf.
      f("category", "Category", "text"),
      f("subCaste", "Caste", "text", { rosterKey: "subCaste" }),
    ],
  },
  {
    id: "father",
    title: "Father",
    fields: [
      f("fatherName", "Name of the father", "text", { rosterKey: "fatherName" }),
      f("fatherOccupation", "Occupation", "text", { rosterKey: "fatherOccupation" }),
      f("fatherContactNo", "Mobile number", "phone", { rosterKey: "fatherContactNo" }),
      f("fatherLandline", "Landline with STD code", "landline"),
      f("fatherEmail", "E-mail", "email"),
      f("permanentAddress", "Permanent address", "address", { rosterKey: "permanentAddress", fallbackKeys: ["temporaryAddress"] }),
    ],
  },
  {
    id: "mother",
    title: "Mother",
    fields: [
      f("motherName", "Name of the mother", "text", { rosterKey: "motherName" }),
      f("motherOccupation", "Occupation", "text", { rosterKey: "motherOccupation" }),
      f("motherContactNo", "Mobile number", "phone", { rosterKey: "motherContactNo" }),
      f("motherLandline", "Landline with STD code", "landline"),
      f("motherEmail", "E-mail", "email"),
      f("motherAddress", "Address", "address", { fallbackKeys: ["permanentAddress", "temporaryAddress"] }),
    ],
  },
  {
    id: "guardian",
    title: "Local guardian",
    fields: [
      f("guardianName", "Local guardian", "text", { rosterKey: "guardianName" }),
      f("guardianOccupation", "Occupation", "text"),
      f("guardianContact", "Mobile number", "phone", { rosterKey: "guardianContact" }),
      f("guardianLandline", "Landline with STD code", "landline"),
      f("guardianEmail", "E-mail", "email"),
      f("guardianAddress", "Address", "address"),
    ],
  },
];

const QUALIFYING: { exam: string; prefix: QualifyingRow["prefix"] }[] = [
  { exam: "Class X", prefix: "ssc" },
  { exam: "Class XII", prefix: "inter" },
  { exam: "Diploma", prefix: "diploma" },
];

const QUALIFYING_PARTS = [
  { suffix: "Institution", label: "Name of the institution", kind: "text" as const },
  { suffix: "YearOfPass", label: "Year of passing", kind: "text" as const },
  { suffix: "Board", label: "Board", kind: "text" as const },
  { suffix: "Percentage", label: "% of marks obtained", kind: "text" as const },
];

const FIELD_DEFS = new Map<string, FieldDef>();
for (const g of GROUPS) for (const d of g.fields) FIELD_DEFS.set(d.key, d);
for (const q of QUALIFYING) {
  for (const p of QUALIFYING_PARTS) {
    const key = `${q.prefix}${p.suffix}`;
    FIELD_DEFS.set(key, { key, label: p.label, kind: p.kind, rosterKey: key });
  }
}

/** Category as the booklet ticks it, from the roster's caste (OC, EBC/EPC/BC-x, SC, ST); "" when it can't tell. */
export function categoryOf(caste: unknown): string {
  const c = typeof caste === "string" ? caste.trim().toUpperCase() : "";
  if (c === "OC" || c === "SC" || c === "ST") return c;
  if (c === "EBC" || c === "EPC" || c.startsWith("BC")) return "OBC";
  return "";
}

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
};

function studentValue(def: FieldDef, student: Source): string {
  if (def.key === "category") return categoryOf(student.caste);
  const direct = def.rosterKey ? text(student[def.rosterKey]) : "";
  if (direct) return direct;
  for (const k of def.fallbackKeys ?? []) {
    const v = text(student[k]);
    if (v) return v;
  }
  return "";
}

function viewOf(def: FieldDef, student: Source, overrides: Record<string, string>): RecordFieldView {
  const own = studentValue(def, student);
  if (own) {
    return { key: def.key, label: def.label, kind: def.kind, value: own, source: def.key === "category" ? "DERIVED" : "STUDENT", editable: false };
  }
  const added = text(overrides[def.key]);
  if (added) {
    return { key: def.key, label: def.label, kind: def.kind, value: added, source: "MENTOR", editable: !def.locked };
  }
  return { key: def.key, label: def.label, kind: def.kind, value: "", source: null, editable: !def.locked };
}

/** Page 1 and 7.1 for one student: every field with its value, source and whether it can be filled in. */
export function buildRecordProfile(student: Source, overrides: Record<string, string> = {}): MentoringRecordProfile {
  const groups: RecordProfileGroup[] = GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    fields: g.fields.map((d) => viewOf(d, student, overrides)),
  }));
  const qualifying: QualifyingRow[] = QUALIFYING.map(({ exam, prefix }) => {
    const cell = (suffix: string) => viewOf(FIELD_DEFS.get(`${prefix}${suffix}`)!, student, overrides);
    return { exam, prefix, institution: cell("Institution"), yearOfPass: cell("YearOfPass"), board: cell("Board"), percentage: cell("Percentage") };
  });
  const all = [...groups.flatMap((g) => g.fields), ...qualifying.flatMap((q) => [q.institution, q.yearOfPass, q.board, q.percentage])];
  return { groups, qualifying, missingCount: all.filter((x) => x.editable && !x.value).length };
}

export type OverrideResult =
  | { ok: true; /** key -> cleaned value, "" = clear the mentor's own entry */ values: Record<string, string> }
  | { ok: false; status: 400 | 409; error: string };

const MAX_SHORT = 200;
const MAX_ADDRESS = 500;

/**
 * Validates what a mentor typed into the missing fields. A key the student's own
 * record already answers is refused (409) - it must be changed on the student's
 * profile, not here. Blank means "take my entry back".
 */
export function cleanProfileOverrides(student: Source, overrides: Record<string, string>, input: unknown): OverrideResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, status: 400, error: "values is required" };
  const raw = input as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length === 0) return { ok: false, status: 400, error: "Nothing to save" };

  const out: Record<string, string> = {};
  for (const key of keys) {
    const def = FIELD_DEFS.get(key);
    if (!def || def.locked) return { ok: false, status: 400, error: `${key} cannot be filled in here` };
    if (studentValue(def, student)) {
      return { ok: false, status: 409, error: `${def.label} is already on the student's record - change it there` };
    }
    const v = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    if (!v) { out[key] = ""; continue; }
    const max = def.kind === "address" ? MAX_ADDRESS : MAX_SHORT;
    if (v.length > max) return { ok: false, status: 400, error: `${def.label} is too long (max ${max} characters)` };
    if (def.kind === "phone") {
      const digits = normalizeStudentMobile(v);
      if (!PHONE_REGEX.test(digits)) return { ok: false, status: 400, error: `${def.label} must be exactly 10 digits, starting with 6, 7, 8 or 9` };
      out[key] = digits;
    } else if (def.kind === "email") {
      const e = v.toLowerCase();
      if (!EMAIL_REGEX.test(e)) return { ok: false, status: 400, error: "Enter a valid email address" };
      out[key] = e;
    } else if (def.kind === "landline") {
      if (!/^[\d\s+\-()]{6,15}$/.test(v)) return { ok: false, status: 400, error: `${def.label} can only contain digits, spaces, +, - and brackets (6-15 characters)` };
      out[key] = v;
    } else if (def.kind === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return { ok: false, status: 400, error: `${def.label} must be a valid date` };
      out[key] = v;
    } else if (key === "category") {
      const c = v.toUpperCase();
      if (!(CATEGORY_OPTIONS as readonly string[]).includes(c)) return { ok: false, status: 400, error: "Category must be OC, OBC, SC or ST" };
      out[key] = c;
    } else {
      out[key] = v;
    }
  }
  // Only entries that change something are worth a write.
  const changed: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) if (v !== text(overrides[k])) changed[k] = v;
  return { ok: true, values: changed };
}
