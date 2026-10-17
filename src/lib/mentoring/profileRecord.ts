import { buildOwnProfileGroups } from "@/lib/students/ownProfile";
import { normalizeStudentMobile } from "@/lib/students/studentMobile";
import { EMAIL_REGEX, PHONE_REGEX } from "@/lib/validations";
import { CATEGORY_OPTIONS, QUALIFICATION_OPTIONS } from "./recordSections";
import type { StudentRecord } from "@/types";
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
  /** Must be filled in once it applies (hostel name / room for a hosteller). */
  required?: boolean;
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
      f("motherEmail", "E-mail", "email"),
      f("motherAddress", "Address", "address", { fallbackKeys: ["permanentAddress", "temporaryAddress"] }),
    ],
  },
  // Guardians are a list on the mentor's side (the "guardians" entry section), not fields here.
  // Hostel name / room have no column on the student's record, so only the mentor holds them.
  {
    id: "hostel",
    title: "Hostel",
    fields: [
      f("hosteller", "Hosteller", "text", { rosterKey: "hosteller" }),
      f("hostelName", "Hostel name", "text", { required: true }),
      f("hostelRoom", "Hostel room", "text", { required: true }),
    ],
  },
  // One entrance exam only: EAPCET after Class XII (Intermediate), or ECET after Diploma (Polytechnic).
  // It has a rank, not marks or a pass percentage. Type and rank are the roster's entranceType / entranceRank.
  {
    id: "entrance",
    title: "Entrance examination",
    fields: [
      // Intermediate (Class XII) or Diploma (Polytechnic): worked out from the student's record, see qualificationOf.
      f("previousQualification", "Qualified through", "text"),
      f("entranceType", "Entrance exam", "text", { rosterKey: "entranceType" }),
      f("entranceHallTicket", "Hall ticket number", "text"),
      f("entranceYear", "Year of exam", "text"),
      f("entranceRank", "Rank", "text", { rosterKey: "entranceRank", required: true }),
    ],
  },
];

/** Hostel name and room are asked (and required) only for a hosteller. */
const HOSTEL_DETAIL_KEYS = ["hostelName", "hostelRoom"];
/** Asked only once an entrance exam is chosen; the rank is required then. */
const ENTRANCE_DETAIL_KEYS = ["entranceHallTicket", "entranceYear", "entranceRank"];

const QUALIFYING: { exam: string; prefix: QualifyingRow["prefix"] }[] = [
  { exam: "Class X (SSC / 10th)", prefix: "ssc" },
  { exam: "Class XII (Intermediate)", prefix: "inter" },
  { exam: "Diploma (Polytechnic)", prefix: "diploma" },
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

/**
 * The roster keys the booklet fields above already show for this student (their own key, and a
 * fallback only when it is the one actually shown). What is left of the student's record is listed
 * read-only under "other details", so this one page carries everything the old Profile tab did -
 * nothing twice, nothing dropped (the raw caste, for one, stays listed: Category is only derived from it).
 */
export function coveredRosterKeys(student: Source): Set<string> {
  const out = new Set<string>();
  for (const d of FIELD_DEFS.values()) {
    if (!d.rosterKey) continue;
    out.add(d.rosterKey);
    if (!text(student[d.rosterKey])) {
      const used = (d.fallbackKeys ?? []).find((k) => text(student[k]));
      if (used) out.add(used);
    }
  }
  return out;
}

/** Things earlier versions of this page let a mentor write that it no longer asks for; shown, not lost. */
const LEGACY_OVERRIDE_LABELS: [string, string][] = [
  ["guardianName", "Local guardian"], ["guardianOccupation", "Guardian occupation"], ["guardianContact", "Guardian mobile number"],
  ["guardianLandline", "Guardian landline"], ["guardianEmail", "Guardian e-mail"], ["guardianAddress", "Guardian address"],
  ["fatherLandline", "Father landline"], ["motherLandline", "Mother landline"],
];

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
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return "";
};

const isYes = (v: string) => v.trim().toUpperCase() === "YES";

/** Whether the student is a hosteller: their own answer wins, else the mentor's. */
function isHosteller(student: Source, overrides: Record<string, string>): boolean {
  return isYes(text(overrides[`${HOD_PREFIX}hosteller`]) || text(student.hosteller) || text(overrides.hosteller));
}

/** The HOD's own edit of a detail is stored beside the mentor's entries under this prefix and wins over both. */
const HOD_PREFIX = "hod_";

/** The chosen entrance exam: the HOD's correction, else the student's own, else the mentor's entry. */
function entranceType(student: Source, overrides: Record<string, string>): string {
  return text(overrides[`${HOD_PREFIX}entranceType`]) || text(student.entranceType) || text(overrides.entranceType);
}

const INTERMEDIATE = QUALIFICATION_OPTIONS[0];
const DIPLOMA = QUALIFICATION_OPTIONS[1];

/**
 * Which route the student came through, from what the student's record says - never assumed:
 * Diploma details, a Lateral admission or an ECET entrance mean Diploma; Class XII details, an
 * EAPCET/EAMCET entrance or a Regular admission mean Intermediate. "" when the record cannot tell
 * (the mentor or HOD then picks it).
 */
export function qualificationOf(student: Source): string {
  const has = (prefix: string) => ["Institution", "YearOfPass", "Board", "Percentage", "Marks", "HallTicketNo"].some((k) => text(student[`${prefix}${k}`]));
  const entrance = text(student.entranceType).toUpperCase();
  const type = text(student.studentType).toUpperCase();
  if (has("diploma") || type === "LATERAL" || entrance === "ECET") return DIPLOMA;
  if (has("inter") || entrance === "EAPCET" || entrance === "EAMCET" || type === "REGULAR") return INTERMEDIATE;
  return "";
}

function qualification(student: Source, overrides: Record<string, string>): string {
  return text(overrides[`${HOD_PREFIX}previousQualification`]) || qualificationOf(student) || text(overrides.previousQualification);
}

function studentValue(def: FieldDef, student: Source): string {
  if (def.key === "category") return categoryOf(student.caste);
  if (def.key === "previousQualification") return qualificationOf(student);
  const direct = def.rosterKey ? text(student[def.rosterKey]) : "";
  if (direct) return direct;
  for (const k of def.fallbackKeys ?? []) {
    const v = text(student[k]);
    if (v) return v;
  }
  return "";
}

function viewOf(def: FieldDef, student: Source, overrides: Record<string, string>, isHod: boolean): RecordFieldView {
  const base = { key: def.key, label: def.label, kind: def.kind };
  const hodEdit = text(overrides[`${HOD_PREFIX}${def.key}`]);
  if (hodEdit) return { ...base, value: hodEdit, source: "HOD", editable: isHod && !def.locked };
  const own = studentValue(def, student);
  // The HOD may correct any detail except identity; a mentor only fills what is missing.
  if (own) return { ...base, value: own, source: def.key === "category" || def.key === "previousQualification" ? "DERIVED" : "STUDENT", editable: isHod && !def.locked };
  const added = text(overrides[def.key]);
  if (added) return { ...base, value: added, source: "MENTOR", editable: !def.locked };
  return { ...base, value: "", source: null, editable: !def.locked };
}

/** Page 1 and 7.1 for one student: every field with its value, source and whether it can be filled in. */
export function buildRecordProfile(student: Source, overrides: Record<string, string> = {}, isHod = false): MentoringRecordProfile {
  const hosteller = isHosteller(student, overrides);
  const hasEntrance = !!entranceType(student, overrides);
  const groups: RecordProfileGroup[] = GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    fields: g.fields.map((d) => ({ ...viewOf(d, student, overrides, isHod), ...(d.required ? { required: true } : {}) })),
  }));
  const qualifying: QualifyingRow[] = QUALIFYING.map(({ exam, prefix }) => {
    const cell = (suffix: string) => viewOf(FIELD_DEFS.get(`${prefix}${suffix}`)!, student, overrides, isHod);
    return { exam, prefix, institution: cell("Institution"), yearOfPass: cell("YearOfPass"), board: cell("Board"), percentage: cell("Percentage") };
  });
  const all = [...groups.flatMap((g) => g.fields), ...qualifying.flatMap((q) => [q.institution, q.yearOfPass, q.board, q.percentage])];
  // Hostel name / room only count as missing for a hosteller.
  const missing = all.filter((x) => x.editable && !x.value && (hosteller || !HOSTEL_DETAIL_KEYS.includes(x.key)) && (hasEntrance || !ENTRANCE_DETAIL_KEYS.includes(x.key)));
  const otherGroups = buildOwnProfileGroups(student as Partial<StudentRecord>, { includeEmpty: true, exclude: coveredRosterKeys(student) });
  const legacy = LEGACY_OVERRIDE_LABELS.filter(([k]) => text(overrides[k])).map(([k, label]) => ({ label, value: text(overrides[k]) }));
  if (legacy.length > 0) otherGroups.push({ title: "Earlier entries by the mentor (no longer asked)", rows: legacy });
  return { groups, qualifying, otherGroups, missingCount: missing.length };
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
export function cleanProfileOverrides(student: Source, overrides: Record<string, string>, input: unknown, isHod = false): OverrideResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, status: 400, error: "values is required" };
  const raw = input as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length === 0) return { ok: false, status: 400, error: "Nothing to save" };

  const out: Record<string, string> = {};
  for (const key of keys) {
    const def = FIELD_DEFS.get(key);
    if (!def || def.locked) return { ok: false, status: 400, error: `${key} cannot be filled in here` };
    const own = studentValue(def, student);
    const hodKey = `${HOD_PREFIX}${key}`;
    // The HOD's correction of a detail is kept apart (hod_<key>) and wins over the student's own value.
    const useHod = isHod && (!!own || !!text(overrides[hodKey]));
    if (!isHod && text(overrides[hodKey])) {
      return { ok: false, status: 409, error: `${def.label} was set by the HOD - only the HOD can change it` };
    }
    if (!isHod && own) {
      return { ok: false, status: 409, error: `${def.label} is already on the student's record - change it there` };
    }
    const target = useHod ? hodKey : key;
    const v = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    if (!v || (useHod && v === own)) { out[target] = ""; continue; }
    const max = def.kind === "address" ? MAX_ADDRESS : MAX_SHORT;
    if (v.length > max) return { ok: false, status: 400, error: `${def.label} is too long (max ${max} characters)` };
    if (def.kind === "phone") {
      const digits = normalizeStudentMobile(v);
      if (!PHONE_REGEX.test(digits)) return { ok: false, status: 400, error: `${def.label} must be exactly 10 digits, starting with 6, 7, 8 or 9` };
      out[target] = digits;
    } else if (def.kind === "email") {
      const e = v.toLowerCase();
      if (!EMAIL_REGEX.test(e)) return { ok: false, status: 400, error: "Enter a valid email address" };
      out[target] = e;
    } else if (def.kind === "landline") {
      if (!/^[\d\s+\-()]{6,15}$/.test(v)) return { ok: false, status: 400, error: `${def.label} can only contain digits, spaces, +, - and brackets (6-15 characters)` };
      out[target] = v;
    } else if (def.kind === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return { ok: false, status: 400, error: `${def.label} must be a valid date` };
      out[target] = v;
    } else if (/YearOfPass$/.test(key)) {
      const year = Number(v);
      if (!/^\d{4}$/.test(v) || year < 1950 || year > new Date().getFullYear() + 1) return { ok: false, status: 400, error: `${def.label} must be a year in YYYY format` };
      out[target] = v;
    } else if (key === "entranceYear") {
      if (!/^\d{4}$/.test(v) || Number(v) < 1950 || Number(v) > new Date().getFullYear() + 1) return { ok: false, status: 400, error: `${def.label} must be a year in YYYY format` };
      out[target] = v;
    } else if (key === "entranceRank") {
      if (!/^\d{1,7}$/.test(v) || Number(v) < 1) return { ok: false, status: 400, error: "Rank must be a whole number" };
      out[target] = v;
    } else if (key === "previousQualification") {
      const q = QUALIFICATION_OPTIONS.find((o) => o.toUpperCase() === v.toUpperCase());
      if (!q) return { ok: false, status: 400, error: "Qualified through must be Intermediate (Class XII) or Diploma (Polytechnic)" };
      out[target] = q;
    } else if (key === "entranceType") {
      const t = v.toUpperCase();
      if (t !== "EAPCET" && t !== "ECET") return { ok: false, status: 400, error: "Entrance exam must be EAPCET or ECET" };
      out[target] = t;
    } else if (/Percentage$/.test(key)) {
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || Number(v) > 100) return { ok: false, status: 400, error: `${def.label} must be a number from 0 to 100` };
      out[target] = v;
    } else if (key === "hosteller") {
      const y = v.toUpperCase();
      if (y !== "YES" && y !== "NO") return { ok: false, status: 400, error: "Hosteller must be Yes or No" };
      out[target] = y === "YES" ? "Yes" : "No";
    } else if (key === "category") {
      const c = v.toUpperCase();
      if (!(CATEGORY_OPTIONS as readonly string[]).includes(c)) return { ok: false, status: 400, error: "Category must be OC, OBC, SC or ST" };
      out[target] = c;
    } else {
      out[target] = v;
    }
  }
  // A hosteller must have a hostel name and room. Checked only when this save touches the hostel
  // answers, so an unrelated save is never blocked by older records that lack them.
  if (keys.some((k) => k === "hosteller" || HOSTEL_DETAIL_KEYS.includes(k))) {
    const merged: Record<string, string> = { ...overrides };
    for (const [k, v] of Object.entries(out)) merged[k] = v;
    if (isHosteller(student, merged)) {
      for (const k of HOSTEL_DETAIL_KEYS) {
        if (!text(merged[`${HOD_PREFIX}${k}`]) && !text(merged[k])) return { ok: false, status: 400, error: `${FIELD_DEFS.get(k)!.label} is required for a hosteller` };
      }
    }
  }
  // Once an entrance exam is chosen its rank is required (checked only when this save touches those answers).
  if (keys.some((k) => k === "entranceType" || k === "previousQualification" || ENTRANCE_DETAIL_KEYS.includes(k))) {
    const merged: Record<string, string> = { ...overrides };
    for (const [k, v] of Object.entries(out)) merged[k] = v;
    const rank = text(merged.hod_entranceRank) || text(student.entranceRank) || text(merged.entranceRank);
    const route = qualification(student, merged);
    const chosen = entranceType(student, merged).toUpperCase();
    if (route === DIPLOMA && chosen === "EAPCET") return { ok: false, status: 400, error: "EAPCET follows Class XII; this student came through a Diploma, so the entrance exam is ECET" };
    if (route === INTERMEDIATE && chosen === "ECET") return { ok: false, status: 400, error: "ECET follows a Diploma; this student came through Intermediate, so the entrance exam is EAPCET" };
    if (chosen && !rank) return { ok: false, status: 400, error: "Rank is required for the entrance exam" };
  }
  // Only entries that change something are worth a write.
  const changed: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) if (v !== text(overrides[k])) changed[k] = v;
  return { ok: true, values: changed };
}
