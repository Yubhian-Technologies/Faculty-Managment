import type { CeaMarkEntry, CeaMarksSheet } from "@/types/cea";
import { cleanQuestionValues, paperTotal, questionMarksError, scaleToComponent, type QuestionSheet } from "@/lib/exams/questionMarks";
import { CeaRuleError, scaleCea } from "./rules";

// CEA marks - pure. One sheet per section's teaching assignment and unit. In-class units: one number
// (0..unit marks) or Absent (= 0). A with-Mid unit: question by question from the printed CEA paper when
// there is one (its total worked out here, never trusted from the browser), else one number.

export const ceaSheetId = (assignmentId: string, unit: number) => `${assignmentId}__U${unit}`;

export const isEntered = (e: Pick<CeaMarkEntry, "marks" | "absent">) => e.absent === true || e.marks != null;

/** Applies the browser's entries to a sheet's students (unknown students ignored). */
export function applyCeaEntries(existing: CeaMarkEntry[], raw: unknown, unitMarks: number, sheet: QuestionSheet | null): CeaMarkEntry[] {
  const given = new Map<string, Record<string, unknown>>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.studentId === "string") given.set(o.studentId, o);
  }
  return existing.map((e) => {
    const g = given.get(e.studentId);
    if (!g) return e;
    if (g.absent === true) return { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, marks: 0, absent: true };
    if (sheet && g.questionMarks && typeof g.questionMarks === "object") {
      const values = cleanQuestionValues(sheet, g.questionMarks);
      const bad = questionMarksError(sheet, values);
      if (bad) throw new CeaRuleError(`${e.rollNumber || e.name}: ${bad}`);
      const total = paperTotal(sheet, values);
      return { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, marks: total == null ? null : scaleToComponent(total, sheet.paperMax, unitMarks), questionMarks: values };
    }
    const v = g.marks;
    if (v === null || v === undefined || v === "") return { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, marks: null };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > unitMarks || !Number.isInteger(n * 2)) throw new CeaRuleError(`${e.rollNumber || e.name}: marks must be 0-${unitMarks} (halves allowed)`);
    return { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, marks: n };
  });
}

/** Re-lists a draft's students from the current roster, keeping marks of students still there. */
export function reconcileRoster(existing: CeaMarkEntry[], roster: { id: string; rollNumber: string; name: string }[]): CeaMarkEntry[] {
  const by = new Map(existing.map((e) => [e.studentId, e]));
  return roster.map((s) => {
    const e = by.get(s.id);
    return e ? { ...e, rollNumber: s.rollNumber, name: s.name } : { studentId: s.id, rollNumber: s.rollNumber, name: s.name, marks: null };
  });
}

/**
 * The CEA component of each student: their SUBMITTED units added up over every planned unit (a unit not submitted
 * yet counts 0) and scaled to the component's max. null for everyone until a unit is submitted.
 */
export function ceaComponentValues(plannedUnits: number, unitMarks: number, sheets: Pick<CeaMarksSheet, "status" | "entries">[], componentMax: number): Map<string, number | null> {
  const submitted = sheets.filter((s) => s.status === "SUBMITTED");
  const students = new Set(submitted.flatMap((s) => s.entries.map((e) => e.studentId)));
  const out = new Map<string, number | null>();
  for (const id of students) {
    const marks = submitted.map((s) => s.entries.find((e) => e.studentId === id)?.marks ?? null);
    while (marks.length < plannedUnits) marks.push(null);
    out.set(id, scaleCea(marks.slice(0, Math.max(plannedUnits, marks.length)).map((m) => m ?? 0), unitMarks, componentMax));
  }
  return out;
}
