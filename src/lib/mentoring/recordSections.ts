// The tables and lists of the Student Mentoring Record that the mentor fills in -
// one definition shared by the API (validation) and the pages (forms and tables),
// so a column added here appears in both. Pure and client-safe.
//
// Every one of them is stored the same way: one document per row at
// students/{id}/mentoringEntries/{entryId} = { section, semester?, values }.

export type EntryColumnKind = "text" | "textarea" | "date" | "month" | "select" | "check" | "multiselect";

/** What a stored cell holds: text, a ticked box, or (multiselect) the chosen option values. */
export type EntryValue = string | boolean | string[];

export interface EntryChoice { value: string; label: string; hint?: string }

export interface EntryColumn {
  key: string;
  label: string;
  kind: EntryColumnKind;
  options?: readonly string[];
  /** multiselect: the tickable choices, stored by `value`. */
  choices?: readonly EntryChoice[];
  placeholder?: string;
  required?: boolean;
  /** Longest accepted text (default 200, 1000 for textarea). */
  max?: number;
}

export type EntryLayout = "list" | "table";

export interface EntrySection {
  key: string;
  title: string;
  /** One line under the title. */
  hint?: string;
  layout: EntryLayout;
  columns: EntryColumn[];
  maxEntries: number;
  /** Rows belong to one semester (meetings). */
  perSemester?: boolean;
  addLabel: string;
  emptyText: string;
}

/** What a mentor meeting can be about (ticked on each meeting). `value` is what is stored - never rename one. */
export const MEETING_CATEGORIES: readonly EntryChoice[] = [
  { value: "ACADEMIC", label: "Academic progress", hint: "Marks, backlogs, attendance, learning difficulties and study habits." },
  { value: "WELLBEING", label: "Personal wellbeing", hint: "Adjustment, relationships, homesickness, stress and requests for support." },
  { value: "CAREER", label: "Career development", hint: "Higher education, placements, internships, competitive examinations and goals." },
  { value: "ENGAGEMENT", label: "Engagement and skills", hint: "Clubs, sports, hobbies, leadership, communication and social engagement." },
  { value: "CAMPUS_FAMILY", label: "Campus and family support", hint: "Hostel adjustment, financial or practical difficulties and requests for institutional assistance." },
  { value: "GOALS", label: "Personal goals", hint: "Short-term targets, discipline, confidence, habits and progress against previous commitments." },
];

const meetingCategoryLabel = new Map(MEETING_CATEGORIES.map((c) => [c.value, c.label]));
export const meetingCategoryName = (value: string): string => meetingCategoryLabel.get(value) ?? value;

export const WEEKLY_ATTENDANCE_OPTIONS = ["Present", "Absent", "Excused"] as const;
export const FOLLOW_UP_STATUS_OPTIONS = ["Open", "In progress", "Done"] as const;
export const ESCALATION_TO_OPTIONS = ["HOD", "Counsellor", "Vice-Principal", "Principal"] as const;
export const ESCALATION_STATUS_OPTIONS = ["Open", "Under review", "Resolved"] as const;

const DOCS_NOTE = "Copies of supporting documents are submitted to the mentor";
const docsCol: EntryColumn = { key: "docReceived", label: "Supporting document received", kind: "check" };

// 7.2 - 7.5 and 8 of the booklet are free text; rows let the mentor add one item at a time, dated if known.
const freeText = (key: string, title: string, hint: string, withDocs: boolean): EntrySection => ({
  key,
  title,
  hint,
  layout: "list",
  columns: [
    { key: "text", label: "Details", kind: "textarea", required: true, placeholder: "Write it as it should appear on the record" },
    { key: "date", label: "Date (if known)", kind: "date" },
    ...(withDocs ? [docsCol] : []),
  ],
  maxEntries: 60,
  addLabel: "Add item",
  emptyText: "Nothing recorded.",
});

export const ENTRY_SECTIONS: EntrySection[] = [
  // ── Previous record (booklet p.2) ──────────────────────────────────────────
  freeText("previousAwards", "Scholarships / awards received", `Before joining the college. ${DOCS_NOTE}.`, true),
  freeText("previousCoCurricular", "Co-curricular achievements", `Before joining the college. ${DOCS_NOTE}.`, true),
  freeText("previousExtraCurricular", "Extra-curricular achievements", `Before joining the college. ${DOCS_NOTE}.`, true),
  freeText("healthRecord", "Health record of chronic ailment or allergy", "Only what the mentor needs to know. Visible to this student's mentor and HOD.", false),
  freeText("otherInfo", "Any other information", "Anything else worth keeping on the record.", false),

  // ── Student information (booklet p.1) ──────────────────────────────────────
  {
    key: "siblings",
    title: "Brother / sister in Sri Vishnu Educational Society",
    hint: "Studying or studied in any college of the Society.",
    layout: "table",
    columns: [
      { key: "collegeName", label: "College", kind: "text", required: true },
      { key: "siblingName", label: "Name of the sibling", kind: "text", required: true },
      { key: "rollNumber", label: "Roll No", kind: "text" },
      { key: "branch", label: "Branch", kind: "text" },
      { key: "academicYear", label: "Academic year", kind: "text", placeholder: "2024-25" },
    ],
    maxEntries: 10,
    addLabel: "Add sibling",
    emptyText: "No sibling recorded.",
  },
  {
    key: "guardians",
    title: "Guardian",
    hint: "Someone other than the parents who looks after the student. Kept by the mentor - students cannot edit it.",
    layout: "table",
    columns: [
      { key: "name", label: "Name of the guardian", kind: "text", required: true },
      { key: "relationship", label: "Relationship", kind: "text", placeholder: "Uncle, aunt, ..." },
      { key: "occupation", label: "Occupation", kind: "text" },
      { key: "mobile", label: "Mobile number", kind: "text", placeholder: "9876543210", max: 15 },
      { key: "email", label: "E-mail", kind: "text" },
      { key: "address", label: "Address", kind: "textarea", max: 500 },
    ],
    maxEntries: 5,
    addLabel: "Add guardian",
    emptyText: "No guardian recorded.",
  },
  {
    key: "addressChanges",
    title: "Change of address or phone number",
    hint: "Changes the student tells the mentor about, after the details above were filled in.",
    layout: "table",
    columns: [
      { key: "what", label: "What changed", kind: "select", options: ["Residential address", "Father's phone", "Mother's phone", "Guardian's phone"], required: true },
      { key: "newValue", label: "New value", kind: "textarea", required: true },
      { key: "date", label: "Date told", kind: "date" },
    ],
    maxEntries: 30,
    addLabel: "Add change",
    emptyText: "No changes reported.",
  },

  // ── Progress & placements (booklet p.11) ───────────────────────────────────
  {
    key: "scholarships",
    title: "Scholarships received",
    hint: DOCS_NOTE,
    layout: "table",
    columns: [
      { key: "name", label: "Name of the scholarship", kind: "text", required: true },
      { key: "monthYear", label: "Month / year", kind: "month" },
      { key: "grant", label: "Grant", kind: "text", placeholder: "₹ 35,000" },
    ],
    maxEntries: 30,
    addLabel: "Add scholarship",
    emptyText: "No scholarship recorded.",
  },
  {
    key: "internships",
    title: "Internship / industrial training",
    hint: DOCS_NOTE,
    layout: "table",
    columns: [
      { key: "organization", label: "Organization / company", kind: "text", required: true },
      { key: "fromDate", label: "From", kind: "date" },
      { key: "toDate", label: "To", kind: "date" },
    ],
    maxEntries: 30,
    addLabel: "Add internship",
    emptyText: "No internship recorded.",
  },
  {
    key: "placements",
    title: "Placement details",
    hint: DOCS_NOTE,
    layout: "table",
    columns: [
      { key: "organization", label: "Organization", kind: "text", required: true },
      { key: "location", label: "Location", kind: "text" },
      { key: "package", label: "Package per annum", kind: "text", placeholder: "6.5 LPA" },
    ],
    maxEntries: 10,
    addLabel: "Add placement",
    emptyText: "No placement recorded.",
  },
  {
    key: "competitiveExams",
    title: "Competitive examinations",
    hint: `GATE / GRE / CAT / TOEFL etc. ${DOCS_NOTE}.`,
    layout: "table",
    columns: [
      { key: "exam", label: "Details of the examination", kind: "text", required: true },
      { key: "result", label: "Result obtained", kind: "text" },
    ],
    maxEntries: 20,
    addLabel: "Add examination",
    emptyText: "No examination recorded.",
  },
  {
    key: "higherStudies",
    title: "Higher studies",
    hint: DOCS_NOTE,
    layout: "table",
    columns: [
      { key: "university", label: "Name of the university", kind: "text", required: true },
      { key: "location", label: "Location", kind: "text" },
    ],
    maxEntries: 10,
    addLabel: "Add university",
    emptyText: "No higher studies recorded.",
  },

  // ── Activities & discipline (booklet p.12) ─────────────────────────────────
  {
    key: "achievements",
    title: "Co-curricular / extra-curricular achievements",
    hint: DOCS_NOTE,
    layout: "table",
    columns: [
      { key: "category", label: "Type", kind: "select", options: ["Co-curricular", "Extra-curricular"], required: true },
      { key: "responsibility", label: "Type of responsibility / achievement", kind: "textarea", required: true },
      { key: "date", label: "Date", kind: "date" },
    ],
    maxEntries: 80,
    addLabel: "Add achievement",
    emptyText: "No achievement recorded.",
  },
  {
    key: "disciplinary",
    title: "Disciplinary issues",
    hint: `If any. ${DOCS_NOTE}.`,
    layout: "table",
    columns: [
      { key: "nature", label: "Nature of the issue", kind: "textarea", required: true },
      { key: "action", label: "Action taken (if any)", kind: "textarea" },
      { key: "date", label: "Date", kind: "date" },
    ],
    maxEntries: 30,
    addLabel: "Add issue",
    emptyText: "No disciplinary issue recorded.",
  },

  // ── Follow-up: weekly check-ins, action items, escalations ─────────────────
  {
    key: "weeklyAttendance",
    title: "Weekly attendance",
    hint: "Whether the student came to the weekly mentoring check-in. Class attendance is read from the college's attendance records - nothing to type for that.",
    layout: "table",
    columns: [
      { key: "weekStart", label: "Week starting", kind: "date", required: true },
      { key: "status", label: "Attended", kind: "select", options: WEEKLY_ATTENDANCE_OPTIONS, required: true },
      { key: "remarks", label: "Remarks", kind: "textarea" },
    ],
    maxEntries: 200,
    addLabel: "Record a week",
    emptyText: "No week recorded.",
  },
  {
    key: "actionItems",
    title: "Action items and follow-ups",
    hint: "What the mentor and the student agreed to do, and whether it got done.",
    layout: "table",
    columns: [
      { key: "action", label: "Action", kind: "textarea", required: true },
      { key: "dueDate", label: "Due date", kind: "date" },
      { key: "status", label: "Status", kind: "select", options: FOLLOW_UP_STATUS_OPTIONS, required: true },
    ],
    maxEntries: 100,
    addLabel: "Add action item",
    emptyText: "No action item.",
  },
  {
    key: "escalations",
    title: "Referral / escalation",
    hint: "A concern passed to someone else for support. Visible to this student's mentor and HOD only; the college summary shows counts, never this text.",
    layout: "table",
    columns: [
      { key: "concern", label: "Concern", kind: "textarea", required: true },
      { key: "escalatedTo", label: "Referred to", kind: "select", options: ESCALATION_TO_OPTIONS, required: true },
      { key: "date", label: "Date", kind: "date" },
      { key: "status", label: "Status", kind: "select", options: ESCALATION_STATUS_OPTIONS, required: true },
      { key: "outcome", label: "Outcome", kind: "textarea" },
    ],
    maxEntries: 30,
    addLabel: "Add referral",
    emptyText: "No referral recorded.",
  },

  // ── Mentor meetings (booklet p.13-16) ──────────────────────────────────────
  {
    key: "meetings",
    title: "Mentor meetings",
    hint: "The booklet asks for 6 to 8 meetings in a semester.",
    layout: "table",
    perSemester: true,
    columns: [
      { key: "date", label: "Date", kind: "date", required: true },
      { key: "categories", label: "Discussion categories", kind: "multiselect", required: true, choices: MEETING_CATEGORIES },
      { key: "purpose", label: "Purpose", kind: "textarea", required: true },
      { key: "outcome", label: "Outcome", kind: "textarea" },
      { key: "studentSigned", label: "Student signed", kind: "check" },
    ],
    maxEntries: 40,
    addLabel: "Record a meeting",
    emptyText: "No meeting recorded for this semester.",
  },
];

const BY_KEY = new Map(ENTRY_SECTIONS.map((s) => [s.key, s]));
export const entrySection = (key: string): EntrySection | undefined => BY_KEY.get(key);

/** How a student reached the degree: Intermediate (then EAPCET) or Diploma (then ECET). */
export const QUALIFICATION_OPTIONS = ["Intermediate (Class XII)", "Diploma (Polytechnic)"] as const;

/** The four categories the booklet ticks. */
export const CATEGORY_OPTIONS = ["OC", "OBC", "SC", "ST"] as const;

/** Longest "remarks of the mentor" a semester page holds. */
export const SEMESTER_REMARKS_MAX_LENGTH = 2000;

/** Meetings per semester the booklet expects. */
export const MEETINGS_TARGET = { min: 6, max: 8 } as const;

function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type CleanEntry =
  | { ok: true; values: Record<string, EntryValue> }
  | { ok: false; error: string };

/**
 * Validates a submitted row against its section and returns what is stored:
 * text trimmed, blank cells left out, checkboxes as booleans. Anything that is
 * not one of the section's columns is refused rather than dropped, so a bad
 * client cannot appear to save something it did not.
 */
export function cleanEntryValues(section: EntrySection, input: unknown): CleanEntry {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "values is required" };
  const raw = input as Record<string, unknown>;
  const known = new Set(section.columns.map((c) => c.key));
  const stray = Object.keys(raw).filter((k) => !known.has(k));
  if (stray.length > 0) return { ok: false, error: `Unknown field: ${stray.join(", ")}` };

  const values: Record<string, EntryValue> = {};
  for (const col of section.columns) {
    const v = raw[col.key];
    if (col.kind === "check") {
      if (v === true || v === "true") values[col.key] = true;
      continue;
    }
    if (col.kind === "multiselect") {
      const allowed = new Set((col.choices ?? []).map((c) => c.value));
      const picked = Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
      if (picked.some((x) => typeof x !== "string" || !allowed.has(x))) return { ok: false, error: `${col.label} has an unknown choice` };
      // keep the definition's order, drop repeats
      const chosen = (col.choices ?? []).map((c) => c.value).filter((x) => picked.includes(x));
      if (chosen.length === 0) {
        if (col.required) return { ok: false, error: `${col.label} is required` };
        continue;
      }
      values[col.key] = chosen;
      continue;
    }
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    if (!s) {
      if (col.required) return { ok: false, error: `${col.label} is required` };
      continue;
    }
    const max = col.max ?? (col.kind === "textarea" ? 1000 : 200);
    if (s.length > max) return { ok: false, error: `${col.label} is too long (max ${max} characters)` };
    if (col.kind === "date" && !isRealDate(s)) return { ok: false, error: `${col.label} must be a valid date` };
    if (col.kind === "month" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return { ok: false, error: `${col.label} must be a valid month` };
    if (col.kind === "select" && !(col.options ?? []).includes(s)) return { ok: false, error: `${col.label} must be one of: ${(col.options ?? []).join(", ")}` };
    if (section.key === "guardians" && col.key === "mobile") {
      const digits = s.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");
      if (!/^[6-9]\d{9}$/.test(digits)) return { ok: false, error: `${col.label} must be exactly 10 digits, starting with 6, 7, 8 or 9` };
      values[col.key] = digits;
      continue;
    }
    values[col.key] = s;
  }
  if (!Object.values(values).some((v) => typeof v === "string" || Array.isArray(v))) return { ok: false, error: "Fill in at least one detail" };
  return { ok: true, values };
}

/** "2025-03" -> "Mar 2025"; anything else is returned as it is. */
export function formatEntryMonth(v: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return v;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1]}`;
}

/** "2025-03-07" -> "07-03-2025", the format the booklet and the rest of the app print. */
export function formatEntryDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}
