// Shared grid/column derivations for every rendering of a SECTION timetable -
// the on-screen InstitutionalTimetableTable, the printable/PDF document
// (sectionTimetablePdf.ts) and the Excel export. These were three
// independently-edited copies of the same logic, which is how the on-screen
// grid ended up labelling its break columns "Tea Break"/"Lunch Break" while the
// PDF printed two bare clock times, and how all three hardcoded MON-SAT
// regardless of what the college's own TimetableRules.workingDays says.

import type { DayOfWeek, Subject, TimetableSlot } from "@/types";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import { formatTime12h } from "./facultyTimetablePdf";

/** Every day of the week this app models, in timetable order. */
export const ALL_DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * The days to lay a grid out over, honouring the college's own configured
 * working days (settings/timetableRules - the very list POST
 * college/timetable-slots validates a new slot's `day` against, so a grid that
 * ignored it could show a Saturday column for a college that teaches Mon-Fri
 * only, and could never show the empty one it was told to skip).
 *
 * Falls back to MON-SAT when nothing is configured, and drops any day a
 * malformed rules doc might carry, since DayOfWeek is a closed union.
 * `occupied` are the days the slots themselves use - always unioned in, so a
 * slot published on a day the rules later stopped listing is still visible
 * rather than silently dropped off the grid.
 */
export function resolveTimetableDays(
  rules?: { workingDays?: DayOfWeek[] } | null,
  occupied?: Iterable<DayOfWeek>,
): DayOfWeek[] {
  const configured = rules?.workingDays?.filter((d) => ALL_DAYS.includes(d)) ?? [];
  const base = configured.length > 0 ? configured : [...DEFAULT_TIMETABLE_RULES.workingDays];
  const days = new Set<DayOfWeek>(base);
  for (const d of occupied ?? []) {
    if (ALL_DAYS.includes(d)) days.add(d);
  }
  return ALL_DAYS.filter((d) => days.has(d));
}

export type TimetableColumn =
  | { kind: "period"; id: string; periodNumber: number; startTime?: string; endTime?: string }
  | { kind: "break"; id: string; breakKind: "lunch" | "short"; label: string; startTime?: string; endTime?: string; durationMinutes?: number };

/**
 * The period/break column sequence for a course-year's day, as one shared
 * derivation. Every clock time comes from the HOD's own `periods` breakdown
 * (falling back to the plain numberOfPeriods/periodDurationMinutes formula
 * buildGrid's defaultPeriodTimings already implements) - a break's window is
 * the gap between the period before it and the period after it, both real
 * times. The previous copies of this logic substituted literal "10:40 AM" /
 * "12:40 PM" fallbacks, so a course-year with no explicit breakdown printed
 * invented clock times on the PDF that matched nothing on screen.
 */
export function buildTimetableColumns(
  timing: Pick<
    import("@/types").CourseYearTiming,
    "numberOfPeriods" | "periods" | "periodDurationMinutes" | "collegeStartTime" | "lunchBreak" | "shortBreaks"
  >,
  opts: {
    shortBreakLabels?: Record<number, string>;
    lunchLabel?: string;
  } = {},
): TimetableColumn[] {
  const periodTimings = timing.periods && timing.periods.length > 0
    ? timing.periods
    : derivePeriodTimings(timing);
  const byPeriod = new Map(periodTimings.map((p) => [p.period, p]));

  const cols: TimetableColumn[] = [];
  for (let p = 1; p <= timing.numberOfPeriods; p++) {
    const t = byPeriod.get(p);
    cols.push({
      kind: "period",
      id: `period_${p}`,
      periodNumber: p,
      startTime: t?.startTime,
      endTime: t?.endTime,
    });

    const next = byPeriod.get(p + 1);
    const pushBreak = (breakKind: "lunch" | "short", label: string, durationMinutes?: number) => {
      cols.push({
        kind: "break",
        id: `break_${breakKind}_${p}`,
        breakKind,
        label,
        startTime: t?.endTime,
        endTime: next?.startTime,
        durationMinutes,
      });
    };

    for (const sb of timing.shortBreaks ?? []) {
      if (sb?.afterPeriod === p) {
        pushBreak("short", opts.shortBreakLabels?.[p] ?? "Short Break", sb.durationMinutes);
      }
    }
    if (timing.lunchBreak?.afterPeriod === p) {
      pushBreak("lunch", opts.lunchLabel ?? "Lunch Break", timing.lunchBreak.durationMinutes);
    }
  }
  return cols;
}

// Local copy of buildGrid's defaultPeriodTimings (which takes the same
// Pick<CourseYearTiming, ...>) so this module doesn't import from there and
// create a cycle through facultyTimetablePdf's own imports.
function derivePeriodTimings(
  timing: Pick<
    import("@/types").CourseYearTiming,
    "collegeStartTime" | "numberOfPeriods" | "periodDurationMinutes" | "lunchBreak" | "shortBreaks"
  >
): import("@/types").PeriodTiming[] {
  const toMinutes = (hhmm: string) => {
    const [h, m] = (hhmm ?? "00:00").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const toHHMM = (total: number) =>
    `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

  const out: import("@/types").PeriodTiming[] = [];
  // Without a real duration there is no honest time to derive - a course-year
  // doc with neither an explicit `periods` breakdown nor a period duration
  // should print no clock times at all rather than "12:00 AM - 12:00 AM" on
  // every column, so callers fall through to the optional cell times.
  if (!timing.periodDurationMinutes || timing.periodDurationMinutes <= 0) return out;
  let cursor = toMinutes(timing.collegeStartTime);
  for (let p = 1; p <= timing.numberOfPeriods; p++) {
    const start = cursor;
    const end = start + timing.periodDurationMinutes;
    out.push({ period: p, startTime: toHHMM(start), endTime: toHHMM(end) });
    cursor = end;
    if (timing.lunchBreak?.afterPeriod === p) cursor += timing.lunchBreak.durationMinutes;
    for (const sb of timing.shortBreaks ?? []) {
      if (sb?.afterPeriod === p) cursor += sb.durationMinutes;
    }
  }
  return out;
}

/** "9:00 AM - 10:00 AM", or undefined when either end is unknown. */
export function periodTimeRange(startTime?: string, endTime?: string): string | undefined {
  if (!startTime || !endTime) return undefined;
  return `${formatTime12h(startTime)} - ${formatTime12h(endTime)}`;
}

/**
 * The abbreviated cell label for a slot, resolved in one place so the grid, the
 * PDF and the Excel sheet can never disagree. Prefers the Subject's own
 * configured shortCode, then its code, then the read-time joined values, and
 * only falls back to deriving one from the name as a last resort.
 */
// A hand-typed (custom) subject is filed under a generated code ("CUS-AB12C")
// that means nothing to anyone - show its typed name wherever a code would go.
// Older custom subjects/assignments still carry that generated code.
const GENERATED_CODE = /^CUS-[A-Z0-9]{5}$/;
export function readableCode(code: string | undefined, name: string | undefined): string | undefined {
  return code && GENERATED_CODE.test(code) ? (name || code) : code;
}

export function slotShortCode(
  slot: TimetableSlot,
  subjects?: Map<string, Subject> | Subject[],
): string {
  const subject = subjects instanceof Map ? subjects.get(slot.subjectId) : subjects?.find((s) => s.id === slot.subjectId);
  if (subject?.shortCode && !GENERATED_CODE.test(subject.shortCode)) return subject.shortCode;
  if (subject?.code) return readableCode(subject.code, subject.name) as string;
  const joined = slot as TimetableSlot & { shortCode?: string; subjectCode?: string };
  if (joined.shortCode && !GENERATED_CODE.test(joined.shortCode)) return joined.shortCode;
  if (joined.subjectCode) return readableCode(joined.subjectCode, slot.subjectName) as string;
  const name = (slot.subjectName ?? "").trim();
  if (!name) return "—";
  if (name.length <= 10) return name.toUpperCase();
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Subject code for display, same resolution order as slotShortCode but full-length. */
export function slotSubjectCode(slot: TimetableSlot, subjects?: Map<string, Subject> | Subject[]): string {
  const subject = subjects instanceof Map ? subjects.get(slot.subjectId) : subjects?.find((s) => s.id === slot.subjectId);
  const joined = slot as TimetableSlot & { subjectCode?: string };
  return readableCode(subject?.code, subject?.name) || readableCode(joined.subjectCode, slot.subjectName) || slotShortCode(slot, subjects);
}

/** Who is actually teaching this slot right now - the substitute wins. */
export function slotFacultyName(slot: TimetableSlot): string {
  return slot.substituteFacultyName || slot.facultyName || "";
}

export interface AllocationEntry {
  code: string;
  shortCode: string;
  name: string;
  subjectType?: string;
  hoursPerWeek?: number;
  faculty: string;
  classroom?: string;
  labBatches: string[];
}

/**
 * The "Allocation of Subjects" table every timetable view prints underneath
 * the grid - deduplicated by subject, with EVERY faculty assigned to it (the
 * previous copy kept only the first slot's `facultyName`, so a subject taught
 * by two faculty across sections, or split into lab batches, lost the second
 * one), plus the room and batch labels a split lab needs to be legible.
 */
export function buildAllocationList(
  slots: TimetableSlot[],
  opts: {
    subjects?: Map<string, Subject> | Subject[];
    assignments?: { subjectId?: string; facultyName?: string; hoursPerWeek?: number; subjectType?: string }[];
  } = {},
): AllocationEntry[] {
  const byKey = new Map<string, AllocationEntry & { facultySet: Set<string> }>();

  for (const slot of slots) {
    const key = slot.subjectId || slot.subjectName;
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      const assign = opts.assignments?.find((a) => a.subjectId && a.subjectId === slot.subjectId);
      const subject = opts.subjects instanceof Map
        ? opts.subjects.get(slot.subjectId)
        : opts.subjects?.find((s) => s.id === slot.subjectId);
      entry = {
        code: slotSubjectCode(slot, opts.subjects),
        shortCode: slotShortCode(slot, opts.subjects),
        name: subject?.name ?? slot.subjectName ?? "",
        subjectType: subject?.type ?? assign?.subjectType,
        hoursPerWeek: assign?.hoursPerWeek,
        faculty: "",
        classroom: slot.classroom,
        labBatches: [],
        facultySet: new Set<string>(),
      };
      byKey.set(key, entry);
    }
    if (slot.labBatch && !entry.labBatches.includes(slot.labBatch)) {
      entry.labBatches.push(slot.labBatch);
    }
    // The assigned faculty, not a one-day substitute - the allocation table
    // describes who owns the subject, and a leave cover would otherwise be
    // listed as a permanent second teacher.
    const name = slot.facultyName || opts.assignments?.find((a) => a.subjectId === slot.subjectId)?.facultyName;
    if (name) entry.facultySet.add(name);
  }

  return Array.from(byKey.values()).map(({ facultySet, ...rest }) => ({
    ...rest,
    // "Not assigned" only when genuinely nobody is - previously the literal
    // "Unassigned" was baked in, uppercase, whether or not that was true.
    faculty: Array.from(facultySet).join(" / ") || "Not assigned",
  }));
}

/** "Bachelor of Technology · Computer Science & Engineering · 2nd Year · Section A" */
export function sectionTimetableTitleLine(parts: {
  departmentName?: string;
  courseName?: string;
  year?: number;
  sectionName?: string;
  batch?: string;
  regulation?: string;
}): string {
  return [
    parts.departmentName,
    parts.courseName,
    parts.year != null ? `${ordinalYear(parts.year)}` : undefined,
    parts.sectionName ? `Section ${parts.sectionName}` : undefined,
    parts.regulation,
  ]
    .filter(Boolean)
    .join(" · ");
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const roman = (n: number) => ROMAN[n] ?? String(n);
/** Year/semester as a roman numeral ("III"); falls back to the plain number past 12. */
export const toRoman = roman;

/** "Bachelor Of Technology" -> "B.Tech" etc.; anything unrecognised is left as written. */
function shortCourseName(course: string): string {
  const c = course.trim();
  if (/^(bachelor of technology|b\.?\s?tech)\b/i.test(c)) return "B.Tech";
  if (/^(master of technology|m\.?\s?tech)\b/i.test(c)) return "M.Tech";
  if (/^(bachelor of engineering|b\.?\s?e)\.?$/i.test(c)) return "B.E";
  if (/^(master of business administration|mba)$/i.test(c)) return "MBA";
  if (/^(master of computer applications|mca)$/i.test(c)) return "MCA";
  return c;
}

/**
 * The short class line printed on a section timetable, e.g. "III B.Tech I Sem CSE A":
 * year and semester in roman numerals, the course abbreviated, and the section as
 * "<branch> <letter>" (a name stored as "CSE-A" reads "CSE A"; a bare "A" is prefixed
 * with the department's initials). Batch, regulation and academic year are left out.
 */
export function timetableClassLine(parts: {
  courseName?: string;
  year?: number;
  semesterLabel?: string;
  sectionName?: string;
  departmentName?: string;
  classroom?: string;
}): string {
  // The LAST number: pickers label a semester "2-1" (year-semester), and the
  // class line already shows the year, so it is the semester within the year.
  const semNumber = parts.semesterLabel?.match(/\d+/g)?.pop();
  const semester = semNumber ? `${roman(Number(semNumber))} Sem` : parts.semesterLabel;
  // A branch-picker name carries the owning department's code first
  // ("BSC-CSE-C" = Basic Science, CSE, C); the class line wants "CSE-C".
  const nameParts = (parts.sectionName ?? "").trim().split(/[-_\s]+/).filter(Boolean);
  let sectionParts = nameParts.length >= 3 ? nameParts.slice(1) : nameParts;
  if (sectionParts.length === 1 && !/[A-Za-z]{2,}/.test(sectionParts[0]) && parts.departmentName) {
    const initials = parts.departmentName.split(/[\s&]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(and|of)$/i.test(w)).map((w) => w[0].toUpperCase()).join("");
    sectionParts = [initials, sectionParts[0]];
  }
  const section = sectionParts.join("-");

  const base = [
    parts.year != null ? roman(parts.year) : undefined,
    parts.courseName ? shortCourseName(parts.courseName) : undefined,
    semester,
    section || undefined,
  ].filter(Boolean).join(" ");

  if (parts.classroom?.trim()) {
    const roomStr = /^room/i.test(parts.classroom.trim()) ? parts.classroom.trim() : `Room: ${parts.classroom.trim()}`;
    return base ? `${base}  |  ${roomStr}` : roomStr;
  }
  return base;
}

export function buildClassTimetableSubtitle(opts: {
  academicYear?: string;
  semester?: number;
  semesterLabel?: string;
  effectiveDate?: string;
}): string {
  const acadYear = opts.academicYear || "2026-2027";
  const semNum = typeof opts.semester === "number"
    ? opts.semester
    : Number(opts.semesterLabel?.match(/\d+/g)?.pop()) || 1;
  const semType = semNum > 0 ? (semNum % 2 === 1 ? "Odd Semester" : "Even Semester") : "Semester";
  // The date is asked for when the timetable is published; until then the line
  // simply has no w.e.f part - no blank to fill in by hand.
  const eff = opts.effectiveDate?.trim();
  const iso = eff?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const shown = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : eff;
  return `Class Time Table for the Academic Year ${acadYear}, ${semType}${shown ? `, w.e.f ${shown}` : ""}`;
}

/**
 * Which period columns to draw as one wide cell. Merging is a CHOICE made in the
 * timetable editor (the user selects the cells): the slots of the earlier period
 * carry `mergeWithNext`. A pair only merges when that flag is set AND the two
 * columns are back-to-back PERIODS (no break between) holding the same subject /
 * faculty / batch / room. Returns the colSpan keyed by the first column's index,
 * and the indexes of the columns it swallows. Break columns never merge and never
 * get merged over.
 */
export function continuousSpans(
  columns: { kind: string; periodNumber?: number }[],
  slotsAt: (periodNumber: number) => TimetableSlot[],
): { spans: Map<number, number>; skipped: Set<number> } {
  const sig = (i: number): string | null => {
    const col = columns[i];
    if (!col || col.kind === "break" || col.periodNumber == null) return null;
    const here = slotsAt(col.periodNumber);
    if (here.length === 0) return null;
    return here
      .map((s) => [s.subjectId, s.assignmentId, s.labBatch ?? "", s.classroom ?? "", s.substituteFacultyName ?? ""].join("|"))
      .sort()
      .join("||");
  };
  const spans = new Map<number, number>();
  const skipped = new Set<number>();
  for (let i = 0; i < columns.length; i++) {
    if (skipped.has(i)) continue;
    const s = sig(i);
    if (s == null) continue;
    const flagged = (k: number) => {
      const c = columns[k];
      return c?.periodNumber != null && slotsAt(c.periodNumber).some((x) => x.mergeWithNext);
    };
    let j = i + 1;
    while (flagged(j - 1) && sig(j) === s) j++;
    if (j - i > 1) {
      spans.set(i, j - i);
      for (let k = i + 1; k < j; k++) skipped.add(k);
    }
  }
  return { spans, skipped };
}

/**
 * Whether a slot is a lab / practical period (coloured differently on every
 * timetable view). The subject's type decides when it's known; a lab batch
 * label always means lab; with no type at all, a "lab"/"practical" name does.
 */
export function isLabSlot(slot: TimetableSlot, subjects?: Map<string, Subject> | Subject[]): boolean {
  if (slot.labBatch) return true;
  const subject = subjects instanceof Map ? subjects.get(slot.subjectId) : subjects?.find((s) => s.id === slot.subjectId);
  const type = subject?.type ?? (slot as TimetableSlot & { subjectType?: string }).subjectType;
  if (type) return type === "PRACTICAL";
  return /\b(lab|laboratory|practical)\b/i.test(slot.subjectName ?? "");
}

/** The effective date entered at publish time, carried on the published slots (latest wins). */
export function latestEffectiveDate(slots: { effectiveDate?: string }[]): string | undefined {
  let best: string | undefined;
  for (const s of slots) if (s.effectiveDate && (!best || s.effectiveDate > best)) best = s.effectiveDate;
  return best;
}

export function getHodSignatureLabel(deptNameOrCode?: string): string {
  if (!deptNameOrCode?.trim()) return "HOD";
  const str = deptNameOrCode.trim();
  if (/^[A-Z]{2,6}$/.test(str)) return `HOD-${str}`;
  // Most specific names first - "computer science and business system" must not
  // fall into the plain "computer science" (CSE) entry, nor "electronics and
  // electrical" into "electronics" (ECE).
  const codeMap: Record<string, string> = {
    "computer science and business": "CSBS",
    "electronics and electrical": "EEE",
    "electronics and communication": "ECE",
    "artificial intelligence and machine": "AIML",
    "artificial intelligence and data": "AIDS",
    "computer science": "CSE",
    "electronics": "ECE",
    "mechanical": "ME",
    "civil": "CIVIL",
    "electrical": "EEE",
    "information technology": "IT",
    "basic science": "BS&H",
    "pharmacy": "PHARM",
  };
  const lower = str.toLowerCase();
  for (const [key, code] of Object.entries(codeMap)) {
    if (lower.includes(key)) return `HOD-${code}`;
  }
  const initials = str.split(/[\s&]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(and|of|department)$/i.test(w)).map((w) => w[0].toUpperCase()).join("");
  return initials ? `HOD-${initials}` : "HOD";
}

export function ordinalYear(year: number): string {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/**
 * Whether the allocation table needs a separate official-code column. The grid
 * prints each subject's short code, so the table's first column must be that
 * same code (otherwise a reader can't match a grid cell to its row); the
 * subject's official code only earns its own column when it actually differs.
 */
export function allocationNeedsOfficialCode(allocation: AllocationEntry[]): boolean {
  return allocation.some((a) => a.code && a.code !== a.shortCode);
}

/** The slot fields cell-merging reads and rewrites. */
interface MergeableSlot {
  subjectId?: string;
  subjectName?: string;
  facultyName?: string;
  substituteFacultyName?: string;
  substituteForName?: string;
  substituteDate?: string;
  labBatch?: string;
}

/**
 * Several faculty of ONE subject in the same cell (co-teaching, or a lab split into batches
 * with a faculty each) become ONE entry: the subject appears once, with every faculty listed
 * ("A, B") and every batch ("Batch 1, Batch 2"). Entries of different subjects stay separate,
 * in their original order. A cover for one of the faculty shows under their name as
 * "Sub: <name>". Used by every on-screen timetable and both downloads, so a cell reads the
 * same wherever it is shown.
 */
export function mergeCoTaughtSlots<T extends MergeableSlot>(cellSlots: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const s of cellSlots) {
    const key = s.subjectId || s.subjectName || `__${groups.size}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return Array.from(groups.values()).map((group) => {
    if (group.length === 1) return group[0];
    const unique = (values: (string | undefined)[]) => Array.from(new Set(values.filter((v): v is string => !!v)));
    const faculty = unique(group.map((g) => (g.substituteFacultyName ? `Sub: ${g.substituteFacultyName}` : g.facultyName)));
    const batches = unique(group.map((g) => g.labBatch));
    return {
      ...group[0],
      facultyName: faculty.join(", "),
      labBatch: batches.length > 0 ? batches.join(", ") : undefined,
      // The names above already carry any cover; a merged entry is not itself "a substitution".
      substituteFacultyName: undefined,
      substituteForName: undefined,
      substituteDate: undefined,
    };
  });
}
