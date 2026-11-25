import { groupError, paperTotal, partTotal, type QuestionSheet } from "@/lib/exams/questionMarks";
import { NOT_ATTEMPTED, type MidMarksEntry, type MidQuestionValue } from "@/types/midMarks";

// Mid marks sheet rules (pure). A box holds a mark (0..its max, halves allowed), "-" = not attempted (counts 0), or
// nothing yet. A student is complete once any box has a mark or "-" (an empty box then counts as not attempted, and
// is stored as "-" on submit - notAttemptedFilled), or they are marked absent (AB = 0). A student with nothing entered
// at all is still pending, so a missed student is never submitted as 0 by accident. The total is the
// paper total under its choice rule (OR pairs / any k / all) and is never scaled - it is out of the paper's marks.

export class MidMarksError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type EntryLike = Pick<MidMarksEntry, "absent" | "q"> & { abParts?: string[] };

/** Format sheets: each part must have a mark (or "-") or be AB; other sheets: any box. */
export function isComplete(sheet: QuestionSheet, e: EntryLike): boolean {
  if (e.absent) return true;
  if (sheet.source === "FORMAT") {
    const ab = new Set(e.abParts ?? []);
    return sheet.parts.every((p) => ab.has(p.id) || sheet.columns.some((c) => c.partId === p.id && e.q[c.key] != null));
  }
  return sheet.columns.some((c) => e.q[c.key] != null);
}

/** Each part's marks for a student: a number, "AB", or null while nothing is entered in it. */
export function partMarks(sheet: QuestionSheet, e: EntryLike): Record<string, number | "AB" | null> {
  const ab = new Set(e.abParts ?? []);
  return Object.fromEntries(sheet.parts.map((p) => {
    if (e.absent || ab.has(p.id)) return [p.id, "AB"];
    const cols = sheet.columns.filter((c) => c.partId === p.id);
    if (cols.every((c) => e.q[c.key] == null)) return [p.id, null];
    const values = Object.fromEntries(cols.map((c) => { const v = e.q[c.key]; return [c.key, typeof v === "number" ? v : 0]; }));
    return [p.id, partTotal(p, values) ?? 0];
  }));
}

/** On submit: the empty boxes of every student with marks become "-" (not attempted). */
export function notAttemptedFilled(sheet: QuestionSheet, entries: MidMarksEntry[]): MidMarksEntry[] {
  return entries.map((e) => {
    if (e.absent || !isComplete(sheet, e) || sheet.columns.every((c) => e.q[c.key] != null)) return e;
    const ab = new Set(e.abParts ?? []);
    const q = Object.fromEntries(sheet.columns.map((c) => [c.key, ab.has(c.partId) ? null : e.q[c.key] ?? NOT_ATTEMPTED])) as Record<string, MidQuestionValue>;
    return { ...e, q, total: entryTotal(sheet, { ...e, q }) };
  });
}

/** The paper total when complete (absent = 0), else null. "-" counts 0. */
export function entryTotal(sheet: QuestionSheet, e: EntryLike): number | null {
  if (e.absent) return 0;
  if (!isComplete(sheet, e)) return null;
  const values = Object.fromEntries(sheet.columns.map((c) => {
    const v = e.q[c.key];
    return [c.key, v === NOT_ATTEMPTED || v == null ? 0 : v];
  }));
  return paperTotal(sheet, values) ?? 0;
}

/** What has been entered so far, for the running total on screen ("-" and empty count 0). */
export function runningTotal(sheet: QuestionSheet, e: EntryLike): number {
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
    // Format sheets: AB per part (the part's boxes are cleared); AB in every part = absent.
    const partIds = new Set(sheet.parts.map((p) => p.id));
    const abList = sheet.source === "FORMAT" && !absent
      ? [...new Set((Array.isArray(g.abParts) ? g.abParts : "abParts" in g ? [] : e.abParts ?? []).filter((x): x is string => typeof x === "string" && partIds.has(x)))]
      : [];
    const allAb = abList.length > 0 && abList.length === sheet.parts.length;
    const ab = new Set(abList);
    const q: Record<string, MidQuestionValue> = absent || allAb
      ? Object.fromEntries(sheet.columns.map((c) => [c.key, null]))
      : Object.fromEntries(sheet.columns.map((c) => [c.key, ab.has(c.partId) ? null : c.key in rawQ ? cleanValue(rawQ[c.key], c.max, c.label, who) : e.q[c.key] ?? null]));
    const bad = groupError(sheet, Object.fromEntries(Object.entries(q).map(([k, v]) => [k, typeof v === "number" ? v : null])));
    if (bad) throw new MidMarksError(`${who}: ${bad}.`);
    const next: MidMarksEntry = {
      studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, q, total: null,
      ...(absent || allAb ? { absent: true } : {}), ...(!absent && !allAb && abList.length ? { abParts: abList } : {}),
    };
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
