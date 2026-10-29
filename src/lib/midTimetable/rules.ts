import type { MidExamSession, MidExamSlot } from "@/types/midTimetable";

// Mid Timetable rules, shared by the Exam Cell builder (live hints) and the
// server (which re-checks every save). Pure - no Firestore, no clock.

export const MAX_SESSIONS = 6;
/** Exams a branch may sit in one day unless the timetable says otherwise. */
export const DEFAULT_MAX_PER_DAY = 2;
export const MAX_DAYS = 31;
export const MAX_SPAN_DAYS = 92;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Every date from `from` to `to` (inclusive) except Sundays - the default exam days. */
export function examDaysBetween(from: string, to: string): string[] {
  if (!DATE.test(from) || !DATE.test(to) || from > to) return [];
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 62) {
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 10 Nov 2026" (built by hand - the same on every machine). */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "10:00" -> "10:00 AM". */
export function timeLabel(t: string): string {
  const m = TIME.exec(t);
  if (!m) return t;
  const [h, min] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const sessionText = (s: MidExamSession) => `${s.label} (${timeLabel(s.from)} - ${timeLabel(s.to)})`;

/**
 * The exam days sent by the builder: real dates, sorted, no repeats, spanning at
 * most ~3 months. They may go outside the Mid's published dates - a postponed
 * or preponed exam can land anywhere.
 */
export function cleanDays(raw: unknown): { days: string[]; error: string } {
  const list = Array.isArray(raw) ? [...new Set(raw.map(String).filter((d) => DATE.test(d) && !Number.isNaN(Date.parse(d))))].sort() : [];
  if (list.length === 0) return { days: [], error: "Pick at least one exam day" };
  if (list.length > MAX_DAYS) return { days: [], error: `At most ${MAX_DAYS} exam days` };
  if ((Date.parse(list[list.length - 1]) - Date.parse(list[0])) / 86_400_000 > MAX_SPAN_DAYS) return { days: [], error: "Exam days can span at most three months" };
  return { days: list, error: "" };
}

/** The sessions sent by the builder: 1-3, labelled, from < to, not overlapping. Ids are S1, S2 ... in time order. */
export function cleanSessions(raw: unknown): { sessions: MidExamSession[]; error: string } {
  const list = (Array.isArray(raw) ? raw : []).map((s) => {
    const o = (s ?? {}) as Partial<MidExamSession>;
    return { id: String(o.id ?? ""), label: String(o.label ?? "").trim().slice(0, 40), from: String(o.from ?? ""), to: String(o.to ?? "") };
  });
  if (list.length === 0) return { sessions: [], error: "Add at least one session" };
  if (list.length > MAX_SESSIONS) return { sessions: [], error: `At most ${MAX_SESSIONS} sessions a day` };
  for (const [i, s] of list.entries()) {
    if (!s.label) return { sessions: [], error: `Session ${i + 1}: give it a name (e.g. Morning)` };
    if (!TIME.test(s.from) || !TIME.test(s.to)) return { sessions: [], error: `${s.label}: pick the start and end time` };
    if (s.from >= s.to) return { sessions: [], error: `${s.label}: the end time must be after the start time` };
  }
  const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) return { sessions: [], error: `${sorted[i - 1].label} and ${sorted[i].label} overlap` };
  }
  const labels = new Set<string>();
  for (const s of sorted) {
    const k = s.label.toLowerCase();
    if (labels.has(k)) return { sessions: [], error: `Two sessions are called ${s.label}` };
    labels.add(k);
  }
  return { sessions: sorted, error: "" };
}

export interface BranchSubject { subjectId: string; subjectCode: string; subjectName: string }

/**
 * A branch's slots as sent by the builder, checked: only the branch's subjects,
 * each once; a plan day + session. Several subjects in one day + session are
 * electives sharing the cell (its heading is `group`, the same for all of them).
 * Unplaced subjects are simply absent. `complete` = every subject placed.
 */
export function checkSlots(raw: unknown, subjects: BranchSubject[], days: string[], sessions: MidExamSession[], maxPerDay: number = DEFAULT_MAX_PER_DAY): { slots: MidExamSlot[]; errors: string[]; complete: boolean } {
  const known = new Map(subjects.map((s) => [s.subjectId, s]));
  const daySet = new Set(days);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const errors: string[] = [];
  const seen = new Set<string>();
  const slots: MidExamSlot[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = (r ?? {}) as Partial<MidExamSlot>;
    const subj = known.get(String(o.subjectId ?? ""));
    if (!subj) { errors.push("A subject that isn't taught in this branch this semester was sent"); continue; }
    if (!o.date && !o.sessionId) continue; // not placed yet
    if (seen.has(subj.subjectId)) { errors.push(`${subj.subjectName} is placed twice`); continue; }
    seen.add(subj.subjectId);
    const date = String(o.date ?? "");
    const sessionId = String(o.sessionId ?? "");
    if (!daySet.has(date)) { errors.push(`${subj.subjectName}: pick one of the exam days`); continue; }
    if (!sessionIds.has(sessionId)) { errors.push(`${subj.subjectName}: pick a session`); continue; }
    const group = String(o.group ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const movedFrom = typeof o.movedFrom === "string" && DATE.test(o.movedFrom) && o.movedFrom !== date ? o.movedFrom : "";
    slots.push({ ...subj, date, sessionId, ...(group ? { group } : {}), ...(movedFrom ? { movedFrom } : {}) });
  }
  // One heading per cell: the first one given.
  const heading = new Map<string, string>();
  for (const sl of slots) if (sl.group && !heading.has(`${sl.date}|${sl.sessionId}`)) heading.set(`${sl.date}|${sl.sessionId}`, sl.group);
  for (const sl of slots) {
    const h = heading.get(`${sl.date}|${sl.sessionId}`);
    if (h) sl.group = h; else delete sl.group;
  }
  // A day: at most `maxPerDay` exams (one exam = one session; electives share it), and never two at overlapping times.
  const byId = new Map(sessions.map((s) => [s.id, s]));
  for (const day of [...new Set(slots.map((s) => s.date))]) {
    const used = [...new Set(slots.filter((s) => s.date === day).map((s) => s.sessionId))].map((id) => byId.get(id)!).sort((a, b) => a.from.localeCompare(b.from));
    if (used.length > maxPerDay) errors.push(`${dayLabel(day)}: ${used.length} exams - at most ${maxPerDay} a day`);
    for (let i = 1; i < used.length; i++) if (used[i].from < used[i - 1].to) errors.push(`${dayLabel(day)}: ${used[i - 1].label} and ${used[i].label} overlap`);
  }
  const order = new Map(sessions.map((s) => [s.id, s.from]));
  slots.sort((a, b) => a.date.localeCompare(b.date) || (order.get(a.sessionId) ?? "").localeCompare(order.get(b.sessionId) ?? "") || a.subjectCode.localeCompare(b.subjectCode));
  return { slots, errors, complete: errors.length === 0 && subjects.every((s) => seen.has(s.subjectId)) };
}

/**
 * Auto-fill: every subject not yet placed goes into the earliest free
 * day + session, in the subjects' order (one session a day = one subject a day).
 * Placed subjects stay where they are. Subjects left over (not enough slots) stay unplaced.
 */
/** A branch's usual session: the one set for it, else the one most of its exams are in, else the first. */
export function usualSessionOf(sessions: MidExamSession[], set: string | undefined, slots: Pick<MidExamSlot, "sessionId">[] = []): string {
  if (set && sessions.some((s) => s.id === set)) return set;
  const count = new Map<string, number>();
  for (const s of slots) count.set(s.sessionId, (count.get(s.sessionId) ?? 0) + 1);
  const most = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return most && sessions.some((s) => s.id === most) ? most : sessions[0]?.id ?? "";
}

export function autoFill(subjects: BranchSubject[], placed: MidExamSlot[], days: string[], sessions: MidExamSession[]): { slots: MidExamSlot[]; unplaced: string[] } {
  const keep = placed.filter((p) => subjects.some((s) => s.subjectId === p.subjectId));
  const busy = new Set(keep.map((p) => `${p.date}|${p.sessionId}`));
  const free: { date: string; sessionId: string }[] = [];
  for (const date of days) for (const s of sessions) if (!busy.has(`${date}|${s.id}`)) free.push({ date, sessionId: s.id });
  const slots = [...keep];
  const unplaced: string[] = [];
  for (const subj of subjects) {
    if (keep.some((p) => p.subjectId === subj.subjectId)) continue;
    const next = free.shift();
    if (!next) { unplaced.push(subj.subjectName); continue; }
    slots.push({ ...subj, ...next });
  }
  return { slots, unplaced };
}

/**
 * Reschedule (postpone / prepone): every exam of one day + session moves to
 * another day + session, keeping its electives heading; each remembers the date
 * it was first published for (`movedFrom`). Refused when the new day + session
 * already has an exam of this branch (nothing is overwritten).
 */
export function rescheduleSlots(slots: MidExamSlot[], from: { date: string; sessionId: string }, to: { date: string; sessionId: string }): { slots: MidExamSlot[]; moved: MidExamSlot[]; clash: string[] } {
  const moving = slots.filter((s) => s.date === from.date && s.sessionId === from.sessionId);
  const clash = slots.filter((s) => s.date === to.date && s.sessionId === to.sessionId && !moving.includes(s)).map((s) => s.subjectName);
  if (moving.length === 0 || clash.length) return { slots, moved: [], clash };
  const next = slots.map((s) => {
    if (!moving.includes(s)) return s;
    const original = s.movedFrom ?? s.date;
    const { movedFrom: _old, ...rest } = s;
    void _old;
    return { ...rest, date: to.date, sessionId: to.sessionId, ...(original !== to.date ? { movedFrom: original } : {}) };
  });
  return { slots: next, moved: next.filter((s) => moving.some((m) => m.subjectId === s.subjectId)), clash: [] };
}
