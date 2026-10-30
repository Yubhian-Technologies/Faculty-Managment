import { DUTY_CATEGORIES, type DesignationLimit, type DutyCategory, type InvigilationRules, type RuleMode } from "@/types/invigilation";

// Invigilation configuration (pure): the defaults, cleaning what the Exam Cell
// saves, how many people a room / session needs, and which limit applies to a
// designation. Every number is the Exam Cell's - nothing here is a fixed rule.

export const DEFAULT_INVIGILATION_RULES: InvigilationRules = {
  categories: { INVIGILATOR: true, RELIEVER: true, SQUAD: true },
  studentsPerInvigilator: 30,
  minPerRoom: 1,
  maxPerRoom: 2,
  roomsPerReliever: 5,
  squadPerSession: 2,
  countCategories: ["INVIGILATOR", "RELIEVER", "SQUAD"],
  limits: [],
  timetableCheck: true,
  suspendExamYearClasses: true,
  missingTimetable: "WARN",
  bufferMinutes: 10,
  excludeCurrentSubjectFaculty: true,
  excludePastSubjectFaculty: false,
  excludeDepartments: [],
  sameRoomRule: "WARN",
  consecutiveSameRoomRule: "WARN",
  approverUids: [],
};

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const optInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const mode = (v: unknown, fallback: RuleMode): RuleMode => (v === "HARD" || v === "WARN" || v === "OFF" ? v : fallback);

/** A designation key compared loosely ("Assistant Professor" = "ASSISTANT_PROFESSOR"). */
export const designationKey = (d: string | undefined | null) => String(d ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");

/** What the Exam Cell saved, made safe: unknown keys dropped, numbers in range, one limit row per designation. */
export function cleanRules(input: unknown): { rules: InvigilationRules; errors: string[] } {
  const b = (input ?? {}) as Partial<InvigilationRules> & Record<string, unknown>;
  const d = DEFAULT_INVIGILATION_RULES;
  const errors: string[] = [];
  const categories = Object.fromEntries(DUTY_CATEGORIES.map((c) => [c, b.categories?.[c] === undefined ? d.categories[c] : Boolean(b.categories[c])])) as Record<DutyCategory, boolean>;
  if (!categories.INVIGILATOR && !categories.RELIEVER && !categories.SQUAD) errors.push("Turn on at least one duty category");
  const minPerRoom = int(b.minPerRoom, 0, 10, d.minPerRoom);
  const maxPerRoom = int(b.maxPerRoom, 1, 10, d.maxPerRoom);
  if (minPerRoom > maxPerRoom) errors.push("Minimum invigilators per room can't be more than the maximum");
  const seen = new Set<string>();
  const limits: DesignationLimit[] = [];
  for (const raw of Array.isArray(b.limits) ? b.limits : []) {
    const l = raw as Partial<DesignationLimit>;
    const key = designationKey(l.designation);
    if (seen.has(key)) { errors.push(`${l.designation || "Default"} has two limit rows`); continue; }
    seen.add(key);
    const byCategory = Object.fromEntries(DUTY_CATEGORIES.map((c) => [c, optInt(l.byCategory?.[c])]).filter(([, v]) => v !== null)) as Partial<Record<DutyCategory, number>>;
    limits.push({ designation: key, perSchedule: optInt(l.perSchedule), perDay: optInt(l.perDay), byCategory, mode: l.mode === "WARN" ? "WARN" : "HARD" });
  }
  const countCategories = (Array.isArray(b.countCategories) ? b.countCategories : d.countCategories).filter((c): c is DutyCategory => DUTY_CATEGORIES.includes(c as DutyCategory));
  const missing = b.missingTimetable === "HARD" || b.missingTimetable === "ALLOW" ? b.missingTimetable : "WARN";
  return {
    errors,
    rules: {
      categories,
      studentsPerInvigilator: int(b.studentsPerInvigilator, 1, 500, d.studentsPerInvigilator),
      minPerRoom, maxPerRoom,
      roomsPerReliever: int(b.roomsPerReliever, 1, 100, d.roomsPerReliever),
      squadPerSession: int(b.squadPerSession, 0, 50, d.squadPerSession),
      countCategories: [...new Set(countCategories)],
      limits,
      timetableCheck: b.timetableCheck === undefined ? d.timetableCheck : Boolean(b.timetableCheck),
      suspendExamYearClasses: b.suspendExamYearClasses === undefined ? d.suspendExamYearClasses : Boolean(b.suspendExamYearClasses),
      missingTimetable: missing,
      bufferMinutes: int(b.bufferMinutes, 0, 240, d.bufferMinutes),
      excludeCurrentSubjectFaculty: b.excludeCurrentSubjectFaculty === undefined ? d.excludeCurrentSubjectFaculty : Boolean(b.excludeCurrentSubjectFaculty),
      excludePastSubjectFaculty: Boolean(b.excludePastSubjectFaculty),
      excludeDepartments: [...new Set((Array.isArray(b.excludeDepartments) ? b.excludeDepartments : []).map((x) => String(x).trim()).filter(Boolean))],
      sameRoomRule: mode(b.sameRoomRule, d.sameRoomRule),
      consecutiveSameRoomRule: mode(b.consecutiveSameRoomRule, d.consecutiveSameRoomRule),
      approverUids: [...new Set((Array.isArray(b.approverUids) ? b.approverUids : []).map(String).filter(Boolean))],
    },
  };
}

/** Rules as stored, completed with today's defaults (a rule added later reads as its default). */
export function rulesOf(stored: Partial<InvigilationRules> | undefined): InvigilationRules {
  return cleanRules({ ...DEFAULT_INVIGILATION_RULES, ...(stored ?? {}) }).rules;
}

/** Invigilators a room needs for this many students. */
export function invigilatorsFor(students: number, r: InvigilationRules): number {
  if (students <= 0) return 0;
  return Math.min(r.maxPerRoom, Math.max(r.minPerRoom, Math.ceil(students / r.studentsPerInvigilator)));
}

/** Relievers a session needs for this many rooms in use. */
export function relieversFor(rooms: number, r: InvigilationRules): number {
  return rooms > 0 ? Math.ceil(rooms / r.roomsPerReliever) : 0;
}

/** The limit row for a designation: its own, else the default row (designation ""), else none. */
export function limitFor(designation: string, r: InvigilationRules): DesignationLimit | null {
  const key = designationKey(designation);
  return r.limits.find((l) => l.designation === key && key) ?? r.limits.find((l) => !l.designation) ?? null;
}

/** "HH:MM" -> minutes. */
export const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const sessionKey = (date: string, from: string, to: string) => `${date}|${from}-${to}`;
export function parseSession(s: string): { date: string; from: string; to: string } {
  const [date = "", time = ""] = s.split("|");
  const [from = "", to = ""] = time.split("-");
  return { date, from, to };
}
