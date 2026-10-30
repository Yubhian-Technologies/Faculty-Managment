import { ACTIVE_DUTY_STATUSES, DUTY_CATEGORY_LABELS, type DutyCategory, type DutyRef, type DutySlot, type InvigilationRules, type RuleMode } from "@/types/invigilation";
import { limitFor, minutes } from "./rules";

// Can this faculty member take this duty? (pure). The server re-runs this in
// the save transaction; the assignment screen runs it for every candidate.
//
// HARD issues are never overridable: a class, leave or another duty at that
// time (with the buffer), teaching a subject written there, an excluded
// department, a category turned off, the same duty twice. WARN issues
// (limits / room repeats / no timetable, as the Exam Cell configured them)
// need an override: a reason and an approver.

export interface TimeRange { from: string; to: string; label: string }

export interface CandidateFacts {
  facultyId: string;
  designation: string;
  department: string;
  /** Classes that day (already without suspended exam-year classes). */
  classes: TimeRange[];
  /** Approved leave that day. */
  leave: TimeRange[];
  /** Has any live timetable period at all (false = data missing). */
  hasTimetable: boolean;
  /** Subjects of the slot this person teaches now / taught before (ids). */
  teachesNow: string[];
  taughtBefore: string[];
  /** Every duty they hold in this schedule (any status; inactive ones are ignored). */
  duties: DutyRef[];
}

export type IssueRule =
  | "CATEGORY_OFF" | "DUPLICATE" | "OVERLAP" | "CLASS" | "LEAVE" | "SUBJECT_NOW" | "SUBJECT_PAST" | "DEPARTMENT"
  | "NO_TIMETABLE" | "LIMIT_SCHEDULE" | "LIMIT_DAY" | "LIMIT_CATEGORY" | "SAME_ROOM" | "CONSECUTIVE_ROOM" | "FULL";

export interface Issue { rule: IssueRule; level: "HARD" | "WARN"; message: string }

/** What the assignment screen shows per person. */
export type Availability = "AVAILABLE" | "NEEDS_OVERRIDE" | "PARTIAL" | "BUSY" | "ON_LEAVE" | "ON_DUTY" | "SUBJECT" | "NO_TIMETABLE" | "NOT_ELIGIBLE";

export interface Evaluation { availability: Availability; issues: Issue[]; freeRanges?: { from: string; to: string }[] }

const active = (d: DutyRef) => ACTIVE_DUTY_STATUSES.includes(d.status);
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const level = (m: RuleMode): "HARD" | "WARN" | null => (m === "OFF" ? null : m);

/** Parts of [from, to] not covered by `busy`. */
export function freeParts(from: string, to: string, busy: { from: string; to: string }[]): { from: string; to: string }[] {
  const start = minutes(from), end = minutes(to);
  const sorted = busy.map((b) => [minutes(b.from), minutes(b.to)] as const).filter(([a, b]) => b > start && a < end).sort((x, y) => x[0] - y[0]);
  const out: { from: string; to: string }[] = [];
  let cursor = start;
  for (const [a, b] of sorted) {
    if (a > cursor) out.push({ from: fmt(cursor), to: fmt(Math.min(a, end)) });
    cursor = Math.max(cursor, b);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push({ from: fmt(cursor), to: fmt(end) });
  return out;
}

const overlaps = (aFrom: string, aTo: string, bFrom: string, bTo: string, gap: number) =>
  minutes(aFrom) < minutes(bTo) + gap && minutes(bFrom) < minutes(aTo) + gap;

/**
 * `sessions` = the schedule's sessions in time order (for "consecutive");
 * `filled` = active people already on this slot (for FULL);
 * `replacing` = a duty being reassigned away from (it doesn't count).
 */
export function evaluate(
  slot: Pick<DutySlot, "key" | "session" | "date" | "from" | "to" | "category" | "roomId" | "room" | "subjects" | "required">,
  f: CandidateFacts,
  r: InvigilationRules,
  ctx: { sessions: string[]; filled: number; replacing?: string } = { sessions: [], filled: 0 },
): Evaluation {
  const issues: Issue[] = [];
  const hard = (rule: IssueRule, message: string) => issues.push({ rule, level: "HARD", message });
  const add = (rule: IssueRule, lvl: "HARD" | "WARN" | null, message: string) => { if (lvl) issues.push({ rule, level: lvl, message }); };
  const duties = f.duties.filter((d) => active(d) && d.dutyId !== ctx.replacing);
  const gap = r.bufferMinutes;

  if (!r.categories[slot.category]) hard("CATEGORY_OFF", `${DUTY_CATEGORY_LABELS[slot.category]} duties are turned off for this schedule`);
  if (duties.some((d) => d.slotKey === slot.key)) hard("DUPLICATE", "Already assigned to this duty");

  // Another duty at an overlapping time (or within the buffer) on that day.
  const clash = duties.find((d) => d.slotKey !== slot.key && d.date === slot.date && overlaps(d.from, d.to, slot.from, slot.to, gap));
  if (clash) hard("OVERLAP", `Already on ${DUTY_CATEGORY_LABELS[clash.category].toLowerCase()} duty ${clash.from}-${clash.to}${gap ? ` (needs ${gap} min between duties)` : ""}`);

  let freeRanges: { from: string; to: string }[] | undefined;
  if (r.timetableCheck) {
    const blocking = f.classes.filter((c) => overlaps(c.from, c.to, slot.from, slot.to, gap));
    if (blocking.length) {
      freeRanges = freeParts(slot.from, slot.to, blocking);
      hard("CLASS", `Class ${blocking.map((c) => `${c.from}-${c.to}${c.label ? ` (${c.label})` : ""}`).join(", ")}`);
    }
    if (!f.hasTimetable) {
      const lvl = r.missingTimetable === "ALLOW" ? null : r.missingTimetable;
      add("NO_TIMETABLE", lvl, "No timetable found - check they are free");
    }
  }
  const away = f.leave.find((l) => overlaps(l.from, l.to, slot.from, slot.to, 0));
  if (away) hard("LEAVE", `On leave${away.label ? ` (${away.label})` : ""}`);

  const now = slot.subjects.filter((s) => f.teachesNow.includes(s.id));
  if (r.excludeCurrentSubjectFaculty && now.length) hard("SUBJECT_NOW", `Teaches ${now.map((s) => s.name).join(", ")} - written here`);
  const past = slot.subjects.filter((s) => f.taughtBefore.includes(s.id) && !f.teachesNow.includes(s.id));
  if (r.excludePastSubjectFaculty && past.length) hard("SUBJECT_PAST", `Taught ${past.map((s) => s.name).join(", ")} before - written here`);
  if (r.excludeDepartments.includes(f.department)) hard("DEPARTMENT", `${f.department} faculty are excluded from these duties`);

  // Designation limits, counting the categories the Exam Cell chose (+ this one).
  const limit = limitFor(f.designation, r);
  if (limit && r.countCategories.includes(slot.category)) {
    const lvl = limit.mode;
    const counted = duties.filter((d) => r.countCategories.includes(d.category));
    const total = counted.length + 1;
    if (limit.perSchedule != null && total > limit.perSchedule) add("LIMIT_SCHEDULE", lvl, `Would have ${total} duties - limit ${limit.perSchedule} for the schedule`);
    const onDay = counted.filter((d) => d.date === slot.date).length + 1;
    if (limit.perDay != null && onDay > limit.perDay) add("LIMIT_DAY", lvl, `Would have ${onDay} duties on ${slot.date} - limit ${limit.perDay} a day`);
    const cap = limit.byCategory?.[slot.category];
    const inCat = duties.filter((d) => d.category === slot.category).length + 1;
    if (cap != null && inCat > cap) add("LIMIT_CATEGORY", lvl, `Would have ${inCat} ${DUTY_CATEGORY_LABELS[slot.category].toLowerCase()} duties - limit ${cap}`);
  }

  // Room repeats (invigilator rooms only).
  if (slot.roomId) {
    const before = duties.filter((d) => d.roomId === slot.roomId && d.slotKey !== slot.key);
    if (before.length) add("SAME_ROOM", level(r.sameRoomRule), `Already had ${slot.room ?? "this room"} on ${before.map((d) => d.date).join(", ")}`);
    const i = ctx.sessions.indexOf(slot.session);
    const next = [ctx.sessions[i - 1], ctx.sessions[i + 1]].filter(Boolean);
    if (i >= 0 && before.some((d) => next.includes(`${d.date}|${d.from}-${d.to}`))) {
      add("CONSECUTIVE_ROOM", level(r.consecutiveSameRoomRule), `Same room in the session next to this one`);
    }
  }
  // The configured number is the number: more needs the rule changed, not an override.
  if (ctx.filled >= slot.required) hard("FULL", `This duty already has its ${slot.required} ${slot.required === 1 ? "person" : "people"} - change the numbers in the configuration to add more`);

  return { availability: availabilityOf(issues), issues, ...(freeRanges?.length ? { freeRanges } : {}) };
}

function availabilityOf(all: Issue[]): Availability {
  // A full slot is about the slot, not the person - shown on the slot instead.
  const issues = all.filter((i) => i.rule !== "FULL");
  const has = (r: IssueRule) => issues.some((i) => i.rule === r && i.level === "HARD");
  if (has("LEAVE")) return "ON_LEAVE";
  if (has("OVERLAP") || has("DUPLICATE")) return "ON_DUTY";
  if (has("CLASS")) return "BUSY";
  if (has("SUBJECT_NOW") || has("SUBJECT_PAST")) return "SUBJECT";
  if (has("NO_TIMETABLE")) return "NO_TIMETABLE";
  if (issues.some((i) => i.level === "HARD")) return "NOT_ELIGIBLE";
  if (issues.some((i) => i.rule === "NO_TIMETABLE")) return "NO_TIMETABLE";
  return issues.length ? "NEEDS_OVERRIDE" : "AVAILABLE";
}

/** BUSY with some of the window free is shown as partly free. */
export function displayAvailability(e: Evaluation): Availability {
  return e.availability === "BUSY" && e.freeRanges?.length ? "PARTIAL" : e.availability;
}

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  AVAILABLE: "Available",
  NEEDS_OVERRIDE: "Needs override",
  PARTIAL: "Partly free",
  BUSY: "Busy - class",
  ON_LEAVE: "On leave",
  ON_DUTY: "Other exam duty",
  SUBJECT: "Teaches the subject",
  NO_TIMETABLE: "No timetable - check",
  NOT_ELIGIBLE: "Not eligible",
};

/** Workload of one person in a schedule. */
export function workload(duties: DutyRef[], countCategories: DutyCategory[], date?: string) {
  const live = duties.filter(active);
  const counted = live.filter((d) => countCategories.includes(d.category));
  const byCategory = { INVIGILATOR: 0, RELIEVER: 0, SQUAD: 0 } as Record<DutyCategory, number>;
  for (const d of live) byCategory[d.category]++;
  return {
    total: counted.length,
    byCategory,
    onDate: date ? counted.filter((d) => d.date === date).length : 0,
    completed: duties.filter((d) => d.status === "COMPLETED").length,
    cancelled: duties.filter((d) => d.status === "CANCELLED").length,
    reassigned: duties.filter((d) => d.status === "REASSIGNED").length,
  };
}

/** Remaining duties a designation's schedule limit leaves (null = no limit). */
export function remainingFor(designation: string, total: number, r: InvigilationRules): number | null {
  const l = limitFor(designation, r);
  return l?.perSchedule != null ? Math.max(0, l.perSchedule - total) : null;
}

/**
 * Fair order for suggestions: available people first, then fewest counted
 * duties, fewest that day, fewest of this category, and a room they haven't had.
 */
export function rankCandidates<T extends { facultyId: string; name: string; evaluation: Evaluation; duties: DutyRef[] }>(
  list: T[], slot: Pick<DutySlot, "date" | "category" | "roomId">, r: InvigilationRules,
): T[] {
  const score = (c: T) => {
    const w = workload(c.duties, r.countCategories, slot.date);
    const hadRoom = slot.roomId && c.duties.some((d) => active(d) && d.roomId === slot.roomId) ? 1 : 0;
    const rank = c.evaluation.availability === "AVAILABLE" ? 0 : c.evaluation.availability === "NEEDS_OVERRIDE" || c.evaluation.availability === "NO_TIMETABLE" ? 1 : 2;
    return [rank, w.total, w.onDate, w.byCategory[slot.category], hadRoom];
  };
  return [...list].sort((a, b) => {
    const x = score(a), y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.name.localeCompare(b.name);
  });
}
