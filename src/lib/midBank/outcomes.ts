import type { CourseOutcome, OutcomeMapping, SyllabusUnit } from "@/types/midQuestionBank";
import { LIMITS, MAPPING_TARGETS } from "./constants";

// Units, Course Outcomes and the CO -> PO/PSO mapping of one subject in one
// branch: checking what a faculty member entered, and working out which POs /
// PSOs a question's COs reach. The mapping is ticked (PO1-PO11, PSO1, PSO2), no
// strength levels. Pure - the API re-runs it on every save.

export interface OutcomesInput {
  units: SyllabusUnit[];
  cos: CourseOutcome[];
  mapping: OutcomeMapping;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const order = (ids: Iterable<string>) => [...new Set(ids)].filter((t) => MAPPING_TARGETS.includes(t)).sort((a, b) => MAPPING_TARGETS.indexOf(a) - MAPPING_TARGETS.indexOf(b));

/**
 * Normalises a setup form and lists what is wrong with it. Units and COs are
 * renumbered 1..n in the order given (their ids follow their position), so there
 * are never gaps; a CO's mapping keeps only known POs / PSOs. Older saves stored
 * `{ PO1: 3, ... }` per CO - those read as the POs they named.
 */
export function cleanOutcomes(raw: unknown): { value: OutcomesInput; errors: string[] } {
  const r = (raw ?? {}) as Partial<Record<keyof OutcomesInput, unknown>>;
  const errors: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v : []);

  const units = list(r.units).map((u, i) => {
    // The syllabus keeps its line breaks (one topic per line); only trimmed and capped.
    const syllabus = String((u as SyllabusUnit)?.syllabus ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, LIMITS.unitSyllabus);
    return { no: i + 1, title: clean((u as SyllabusUnit)?.title, LIMITS.unitTitle), ...(syllabus ? { syllabus } : {}) };
  });
  const cos = list(r.cos).map((c, i) => ({ id: `CO${i + 1}`, statement: clean((c as CourseOutcome)?.statement, LIMITS.statement) }));

  if (units.length === 0) errors.push("Add at least one unit");
  if (units.length > LIMITS.units) errors.push(`At most ${LIMITS.units} units`);
  units.forEach((u) => { if (!u.title) errors.push(`Unit ${u.no} needs a title`); });
  if (cos.length === 0) errors.push("Add at least one Course Outcome");
  if (cos.length > LIMITS.cos) errors.push(`At most ${LIMITS.cos} Course Outcomes`);
  cos.forEach((c) => { if (!c.statement) errors.push(`${c.id} needs its statement`); });

  const rawMap = (r.mapping && typeof r.mapping === "object" ? r.mapping : {}) as Record<string, unknown>;
  const mapping: OutcomeMapping = {};
  for (const co of cos) {
    const row = rawMap[co.id];
    const ids = Array.isArray(row) ? row.map(String) : row && typeof row === "object" ? Object.keys(row).filter((k) => (row as Record<string, unknown>)[k]) : [];
    mapping[co.id] = order(ids);
  }
  return { value: { units, cos, mapping }, errors };
}

/** Mapping problems, kept apart so the Course Outcomes step can be saved before the mapping is done. */
export function mappingErrors(value: Pick<OutcomesInput, "cos" | "mapping">): string[] {
  return value.cos.filter((c) => (value.mapping[c.id] ?? []).length === 0).map((c) => `${c.id} is not mapped to any PO or PSO`);
}

/** The POs / PSOs a set of COs reaches, in PO1..PO11, PSO1, PSO2 order. */
export function derivePoPso(coIds: string[], mapping: OutcomeMapping): string[] {
  return order(coIds.flatMap((co) => {
    const row = mapping[co] as unknown;
    return Array.isArray(row) ? row.map(String) : row && typeof row === "object" ? Object.keys(row) : [];
  }));
}

/**
 * What an outcomes edit would take away from questions already written: a unit
 * or CO that questions use must stay. `used` = units and COs found in questions.
 */
export function outcomeConflicts(next: OutcomesInput, used: { units: Set<number>; cos: Set<string> }): string[] {
  const out: string[] = [];
  const unitNos = new Set(next.units.map((u) => u.no));
  const coIds = new Set(next.cos.map((c) => c.id));
  for (const u of [...used.units].sort((a, b) => a - b)) if (!unitNos.has(u)) out.push(`Unit ${u} already has questions and can't be removed`);
  for (const c of [...used.cos].sort()) if (!coIds.has(c)) out.push(`${c} is used by questions and can't be removed`);
  return out;
}
