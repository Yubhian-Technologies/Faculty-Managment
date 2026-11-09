import type { CourseOutcome, OutcomeMapping, SubjectOutcomes, SubjectSyllabus, SubjectSyllabusStatus, SyllabusFieldChange, SyllabusUnit } from "@/types";
import { cleanOutcomes, mappingErrors } from "@/lib/midBank/outcomes";

// A subject's syllabus (units, COs - each in a unit - and the CO -> PO/PSO ticks): checking what the HOD /
// Academics entered, who may do what in which state, and what an edit after the freeze changed. Pure - the
// API re-runs it on every save. See types/subjectSyllabus.ts for the flow.

export const HISTORY_MAX = 300;

/** Mid question banks / papers started on a subject's syllabus point at it with this outcomes id. */
export const SYLLABUS_OUTCOMES_PREFIX = "syllabus__";
export const syllabusOutcomesId = (subjectId: string) => `${SYLLABUS_OUTCOMES_PREFIX}${subjectId}`;
export const syllabusSubjectOf = (outcomesId: string) => (outcomesId.startsWith(SYLLABUS_OUTCOMES_PREFIX) ? outcomesId.slice(SYLLABUS_OUTCOMES_PREFIX.length) : null);

export interface SyllabusContent {
  units: SyllabusUnit[];
  cos: CourseOutcome[];
  mapping: OutcomeMapping;
}

/**
 * Normalises the form (units and COs renumbered 1..n in the order given) and lists what is wrong. Every CO must
 * name an existing unit; for a SUBMIT / FREEZE every CO must also be mapped (`complete`).
 */
export function cleanSyllabus(raw: unknown, complete: boolean): { value: SyllabusContent; errors: string[] } {
  const { value, errors } = cleanOutcomes(raw);
  const rawCos = Array.isArray((raw as { cos?: unknown })?.cos) ? ((raw as { cos: unknown[] }).cos) : [];
  const unitNos = new Set(value.units.map((u) => u.no));
  const cos = value.cos.map((c, i) => {
    const unit = Number((rawCos[i] as { unit?: unknown } | undefined)?.unit);
    return { ...c, unit: Number.isInteger(unit) ? unit : 0 };
  });
  for (const c of cos) {
    if (!c.unit) errors.push(`${c.id}: pick its unit`);
    else if (!unitNos.has(c.unit)) errors.push(`${c.id}: Unit ${c.unit} doesn't exist`);
  }
  const out = { units: value.units, cos, mapping: value.mapping };
  if (complete) errors.push(...mappingErrors(out));
  return { value: out, errors };
}

export type SyllabusActor = "HOD" | "ACADEMICS";
export type SyllabusAction = "SAVE" | "SUBMIT" | "FREEZE" | "RETURN";

/**
 * What `actor` may do with a syllabus in `status` (null = none saved yet). HOD: save / submit while it is theirs
 * (none, DRAFT, RETURNED). Academics: freeze or return a SUBMITTED one, and edit a FROZEN one (recorded).
 * Returns the new status, or the refusal.
 */
export function syllabusStep(status: SubjectSyllabusStatus | null, actor: SyllabusActor, action: SyllabusAction): { status: SubjectSyllabusStatus } | { error: string } {
  const hodOwns = status === null || status === "DRAFT" || status === "RETURNED";
  if (actor === "HOD") {
    if (action === "SAVE" || action === "SUBMIT") {
      if (hodOwns) return { status: action === "SUBMIT" ? "SUBMITTED" : status === "RETURNED" ? "RETURNED" : "DRAFT" };
      return { error: status === "SUBMITTED" ? "It is with Academics for freezing - it can't be changed meanwhile" : "The syllabus is frozen - only Academics can change it now" };
    }
    return { error: "Only Academics freezes or returns a syllabus" };
  }
  if (action === "FREEZE" || action === "RETURN") {
    if (status === "SUBMITTED") return { status: action === "FREEZE" ? "FROZEN" : "RETURNED" };
    return { error: status === "FROZEN" ? "It is already frozen" : "The HOD hasn't submitted it yet" };
  }
  if (action === "SAVE") {
    if (status === "FROZEN") return { status: "FROZEN" };
    return { error: "Academics edits a syllabus once it is frozen - until then the HOD prepares it" };
  }
  return { error: "Only the HOD submits a syllabus" };
}

const coLabel = (c: CourseOutcome) => `${c.statement}${c.unit ? ` (Unit ${c.unit})` : ""}`;

/** Every difference between two versions, in words, for the history of an edit after the freeze. */
export function syllabusChanges(before: SyllabusContent, after: SyllabusContent): SyllabusFieldChange[] {
  const out: SyllabusFieldChange[] = [];
  const n = Math.max(before.units.length, after.units.length);
  for (let i = 0; i < n; i++) {
    const a = before.units[i], b = after.units[i];
    const no = i + 1;
    if (!a && b) { out.push({ field: `Unit ${no}`, before: "-", after: b.title }); continue; }
    if (a && !b) { out.push({ field: `Unit ${no}`, before: a.title, after: "(removed)" }); continue; }
    if (a && b && a.title !== b.title) out.push({ field: `Unit ${no} title`, before: a.title, after: b.title });
    if (a && b && (a.syllabus ?? "") !== (b.syllabus ?? "")) out.push({ field: `Unit ${no} topics`, before: a.syllabus || "-", after: b.syllabus || "-" });
  }
  const m = Math.max(before.cos.length, after.cos.length);
  for (let i = 0; i < m; i++) {
    const a = before.cos[i], b = after.cos[i];
    const id = `CO${i + 1}`;
    if (!a && b) out.push({ field: id, before: "-", after: coLabel(b) });
    else if (a && !b) out.push({ field: id, before: coLabel(a), after: "(removed)" });
    else if (a && b) {
      if (a.statement !== b.statement) out.push({ field: `${id} statement`, before: a.statement, after: b.statement });
      if ((a.unit ?? 0) !== (b.unit ?? 0)) out.push({ field: `${id} unit`, before: a.unit ? `Unit ${a.unit}` : "-", after: b.unit ? `Unit ${b.unit}` : "-" });
    }
    const pa = (before.mapping[id] ?? []).join(", "), pb = (after.mapping[id] ?? []).join(", ");
    if ((a || b) && pa !== pb) out.push({ field: `${id} -> POs / PSOs`, before: pa || "-", after: pb || "-" });
  }
  return out;
}

/** The outcomes a Mid bank / paper reads (same shape as a per-branch setup) - only from a FROZEN syllabus. */
export function syllabusAsOutcomes(s: SubjectSyllabus | null): SubjectOutcomes | null {
  if (!s || s.status !== "FROZEN") return null;
  return {
    subjectId: s.subjectId, branch: "", subjectName: s.subjectName, subjectCode: s.subjectCode,
    units: s.units, cos: s.cos, mapping: s.mapping, version: s.version,
    updatedBy: s.updatedByUid, updatedByName: s.updatedByName,
    createdAt: s.frozenAt as never, updatedAt: s.updatedAt as never,
  };
}

/** The COs of one unit - every CO when the COs carry no unit (older setups) or no unit is given. */
export function cosOfUnit(cos: CourseOutcome[], unit: number | null | undefined): CourseOutcome[] {
  if (!unit || !cos.some((c) => c.unit)) return cos;
  return cos.filter((c) => c.unit === unit);
}

export const SYLLABUS_STATUS_LABEL: Record<SubjectSyllabusStatus, string> = {
  DRAFT: "Draft (HOD)",
  SUBMITTED: "With Academics",
  FROZEN: "Frozen",
  RETURNED: "Returned to HOD",
};
