import type { CorrelationLevel, CourseOutcome, OutcomeMapping, ProgramSpecificOutcome, SyllabusUnit } from "@/types/midQuestionBank";
import { LIMITS, PROGRAM_OUTCOMES } from "./constants";

// Units, Course Outcomes, PSOs and the CO -> PO/PSO mapping of one subject:
// checking what a faculty member entered, and working out which POs/PSOs a
// question's COs reach. Pure - the API re-runs it on every save.

export interface OutcomesInput {
  units: SyllabusUnit[];
  cos: CourseOutcome[];
  psos: ProgramSpecificOutcome[];
  mapping: OutcomeMapping;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Normalises a setup form and lists what is wrong with it. Units, COs and PSOs
 * are renumbered 1..n in the order given (their ids follow their position), so
 * there are never gaps.
 */
export function cleanOutcomes(raw: unknown): { value: OutcomesInput; errors: string[] } {
  const r = (raw ?? {}) as Partial<Record<keyof OutcomesInput, unknown>>;
  const errors: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v : []);

  const units = list(r.units).map((u, i) => ({ no: i + 1, title: clean((u as SyllabusUnit)?.title, LIMITS.unitTitle) }));
  const cos = list(r.cos).map((c, i) => ({ id: `CO${i + 1}`, statement: clean((c as CourseOutcome)?.statement, LIMITS.statement) }));
  const psos = list(r.psos).map((p, i) => ({ id: `PSO${i + 1}`, statement: clean((p as ProgramSpecificOutcome)?.statement, LIMITS.statement) }));

  if (units.length === 0) errors.push("Add at least one unit");
  if (units.length > LIMITS.units) errors.push(`At most ${LIMITS.units} units`);
  units.forEach((u) => { if (!u.title) errors.push(`Unit ${u.no} needs a title`); });
  if (cos.length === 0) errors.push("Add at least one Course Outcome");
  if (cos.length > LIMITS.cos) errors.push(`At most ${LIMITS.cos} Course Outcomes`);
  cos.forEach((c) => { if (!c.statement) errors.push(`${c.id} needs its statement`); });
  if (psos.length > LIMITS.psos) errors.push(`At most ${LIMITS.psos} PSOs`);
  psos.forEach((p) => { if (!p.statement) errors.push(`${p.id} needs its statement`); });

  // Mapping: only known COs and PO/PSO ids, values 1-3.
  const targets = new Set([...PROGRAM_OUTCOMES.map((p) => p.id), ...psos.map((p) => p.id)]);
  const rawMap = (r.mapping && typeof r.mapping === "object" ? r.mapping : {}) as Record<string, Record<string, unknown>>;
  const mapping: OutcomeMapping = {};
  for (const co of cos) {
    const row = rawMap[co.id] ?? {};
    const out: Record<string, CorrelationLevel> = {};
    for (const [target, level] of Object.entries(row)) {
      const n = Number(level);
      if (targets.has(target) && (n === 1 || n === 2 || n === 3)) out[target] = n;
    }
    mapping[co.id] = out;
    if (Object.keys(out).length === 0) errors.push(`${co.id} is not mapped to any PO or PSO`);
  }

  return { value: { units, cos, psos, mapping }, errors };
}

/** The POs/PSOs a set of COs reaches, each with its strongest correlation, in PO1..PO12, PSO1.. order. */
export function derivePoPso(coIds: string[], mapping: OutcomeMapping): { id: string; level: CorrelationLevel }[] {
  const best = new Map<string, CorrelationLevel>();
  for (const co of coIds) {
    for (const [target, level] of Object.entries(mapping[co] ?? {})) {
      if (level > (best.get(target) ?? 0)) best.set(target, level);
    }
  }
  const rank = (id: string) => (id.startsWith("PSO") ? 100 : 0) + Number(id.replace(/\D/g, ""));
  return [...best.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([id, level]) => ({ id, level }));
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
