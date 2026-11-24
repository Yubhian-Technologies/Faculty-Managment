import { paperTotal, type QuestionSheet } from "@/lib/exams/questionMarks";
import { NOT_ATTEMPTED, type MidMarksEntry, type MidQuestionValue } from "@/types/midMarks";

// Mid marks sheet rules (pure). A box holds a mark (0..its max, halves allowed), "-" = not attempted (counts 0), or
// nothing yet. A student is complete when every box is filled, or they are marked absent (AB = 0). The total is the
// paper total under its choice rule (OR pairs / any k / all) and is never scaled - it is out of the paper's marks.

export class MidMarksError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function isComplete(sheet: QuestionSheet, e: Pick<MidMarksEntry, "absent" | "q">): boolean {
  if (e.absent) return true;
  return sheet.columns.every((c) => e.q[c.key] != null);
}

/** The paper total when complete (absent = 0), else null. "-" counts 0. */
export function entryTotal(sheet: QuestionSheet, e: Pick<MidMarksEntry, "absent" | "q">): number | null {
  if (e.absent) return 0;
  if (!isComplete(sheet, e)) return null;
  const values = Object.fromEntries(sheet.columns.map((c) => {
    const v = e.q[c.key];
    return [c.key, v === NOT_ATTEMPTED || v == null ? 0 : v];
  }));
  return paperTotal(sheet, values) ?? 0;
}

/** What has been entered so far, for the running total on screen ("-" and empty count 0). */
export function runningTotal(sheet: QuestionSheet, e: Pick<MidMarksEntry, "absent" | "q">): number {
  if (e.absent) return 0;
  const values = Object.fromEntries(sheet.columns.map((c) => {
    const v = e.q[c.key];
    return [c.key, typeof v === "number" ? v : 0];
  }));
  return paperTotal(sheet, values) ?? 0;
}

function cleanValue(raw: unknown, max: number, label: string, who: string): MidQuestionValue {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw === NOT_ATTEMPTED || raw === "-") return NOT_ATTEMPTED;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new MidMarksError(`${who}: ${label} must be between 0 and ${max}.`);
  if (!Number.isInteger(n * 2)) throw new MidMarksError(`${who}: ${label} takes whole or half marks only.`);
  return n;
}

/**
 * Applies the browser's rows ({ studentId, absent?, q? }) to the sheet's students: only students on the sheet and
 * only the sheet's own boxes are taken; totals are worked out here, never trusted from the browser.
 */
export function applyEntries(sheet: QuestionSheet, existing: MidMarksEntry[], raw: unknown): MidMarksEntry[] {
  const given = new Map<string, Record<string, unknown>>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.studentId === "string") given.set(o.studentId, o);
  }
  return existing.map((e) => {
    const g = given.get(e.studentId);
    if (!g) return e;
    const who = e.rollNumber || e.name;
    const absent = g.absent === true;
    const rawQ = (g.q && typeof g.q === "object" ? g.q : {}) as Record<string, unknown>;
    const q: Record<string, MidQuestionValue> = absent
      ? Object.fromEntries(sheet.columns.map((c) => [c.key, null]))
      : Object.fromEntries(sheet.columns.map((c) => [c.key, c.key in rawQ ? cleanValue(rawQ[c.key], c.max, c.label, who) : e.q[c.key] ?? null]));
    const next: MidMarksEntry = { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, q, total: null, ...(absent ? { absent: true } : {}) };
    return { ...next, total: entryTotal(sheet, next) };
  });
}

/** Re-lists a draft's students from the current roster (in the order given), keeping marks of students still there. */
export function reconcileRoster(sheet: QuestionSheet, existing: MidMarksEntry[], roster: { id: string; rollNumber: string; name: string }[]): MidMarksEntry[] {
  const byId = new Map(existing.map((e) => [e.studentId, e]));
  return roster.map((s) => {
    const cur = byId.get(s.id);
    if (cur) return { ...cur, rollNumber: s.rollNumber, name: s.name };
    return { studentId: s.id, rollNumber: s.rollNumber, name: s.name, q: Object.fromEntries(sheet.columns.map((c) => [c.key, null])), total: null };
  });
}

export const completeCount = (sheet: QuestionSheet, entries: MidMarksEntry[]) => entries.filter((e) => isComplete(sheet, e)).length;

/** Whether entry is still allowed on a date (YYYY-MM-DD, IST) against a last date (inclusive); no last date = open. */
export function withinLastDate(today: string, lastDate: string | null | undefined): boolean {
  return !lastDate || today <= lastDate;
}
