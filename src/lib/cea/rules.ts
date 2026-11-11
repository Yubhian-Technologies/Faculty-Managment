import type { CeaPlanUnit, CeaSettings, CeaWhen } from "@/types/cea";
import { scaleToComponent } from "@/lib/exams/questionMarks";

// CEA rules - pure. Settings (Exam Cell, per course + regulation) and the Subject Department's plan per subject.

export const WRITTEN = "WRITTEN";
export const DEFAULT_CEA_TYPES = [
  { id: WRITTEN, label: "Written test" }, { id: "ASSIGNMENT", label: "Assignment" }, { id: "PRESENTATION", label: "Presentation" },
  { id: "QUIZ", label: "Quiz" }, { id: "SEMINAR", label: "Seminar" }, { id: "VIVA", label: "Viva" },
];

export class CeaRuleError extends Error {}

export const ceaSettingsId = (courseKey: string, regulation: string) => `${courseKey}__${regulation}`.replace(/[/\s]+/g, "-").slice(0, 300);

export function defaultCeaSettings(courseKey: string, courseName: string, regulation: string): CeaSettings {
  return { id: ceaSettingsId(courseKey, regulation), courseKey, courseName, regulation, enabled: true, unitMarks: 10, types: DEFAULT_CEA_TYPES.map((t) => ({ ...t })), paperMinutes: 20, version: 0 };
}

const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

export function cleanCeaSettings(raw: unknown): Pick<CeaSettings, "courseKey" | "courseName" | "regulation" | "enabled" | "unitMarks" | "types" | "paperMinutes"> {
  const b = (raw ?? {}) as Partial<CeaSettings>;
  const courseKey = String(b.courseKey ?? "").trim();
  const courseName = String(b.courseName ?? "").trim();
  const regulation = String(b.regulation ?? "").trim().toUpperCase();
  if (!courseKey || !courseName) throw new CeaRuleError("Pick a course");
  if (!regulation || regulation === "ALL") throw new CeaRuleError("Pick the regulation CEA applies to (e.g. R26)");
  const unitMarks = int(b.unitMarks);
  if (!(unitMarks >= 1 && unitMarks <= 100)) throw new CeaRuleError("Marks per unit must be 1 to 100");
  const paperMinutes = int(b.paperMinutes);
  if (!(paperMinutes >= 5 && paperMinutes <= 120)) throw new CeaRuleError("A CEA paper's time must be 5 to 120 minutes");
  const seen = new Set<string>();
  const types = (Array.isArray(b.types) ? b.types : []).map((t) => {
    const label = String(t?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const id = String(t?.id ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 20) || label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20);
    if (!label || !id) throw new CeaRuleError("Each assessment type needs a name");
    if (seen.has(id)) throw new CeaRuleError(`"${label}" is listed twice`);
    seen.add(id);
    return { id, label };
  });
  if (!seen.has(WRITTEN)) types.unshift({ id: WRITTEN, label: "Written test" });
  if (types.length > 15) throw new CeaRuleError("At most 15 assessment types");
  return { courseKey, courseName, regulation, enabled: b.enabled !== false, unitMarks, types, paperMinutes };
}

export const midOf = (when: CeaWhen): number | null => (when.startsWith("MID") ? Number(when.slice(3)) || null : null);

export function whenLabel(when: CeaWhen): string {
  const m = midOf(when);
  return m ? `With Mid ${m}` : "In class";
}

/**
 * Checks a plan against the frozen syllabus units and the settings: every unit planned once, a known type,
 * a with-Mid unit is a written test, a Mid the college runs, and at most one unit per Mid (one CEA paper a sitting).
 */
export function cleanCeaPlan(raw: unknown, syllabusUnits: { unit: number; title: string }[], settings: Pick<CeaSettings, "types">, midCount: number): CeaPlanUnit[] {
  const list = Array.isArray(raw) ? raw : [];
  if (syllabusUnits.length === 0) throw new CeaRuleError("The subject's syllabus has no units");
  const types = new Map(settings.types.map((t) => [t.id, t.label]));
  const byUnit = new Map<number, CeaPlanUnit>();
  for (const r of list) {
    const unit = int((r as { unit?: unknown })?.unit);
    const s = syllabusUnits.find((u) => u.unit === unit);
    if (!s) throw new CeaRuleError(`Unit ${unit} isn't in the syllabus`);
    if (byUnit.has(unit)) throw new CeaRuleError(`Unit ${unit} is planned twice`);
    const when = String((r as { when?: unknown })?.when ?? "") as CeaWhen;
    const mid = midOf(when);
    if (when !== "CLASS" && !(mid && mid >= 1 && mid <= Math.max(midCount, 1))) throw new CeaRuleError(`Unit ${unit}: pick In class or a Mid the college runs`);
    const typeId = mid ? WRITTEN : String((r as { typeId?: unknown })?.typeId ?? "");
    if (!types.has(typeId)) throw new CeaRuleError(`Unit ${unit}: pick an assessment type`);
    byUnit.set(unit, { unit, title: s.title, typeId, when });
  }
  const missing = syllabusUnits.filter((u) => !byUnit.has(u.unit)).map((u) => u.unit);
  if (missing.length) throw new CeaRuleError(`Plan every unit - missing: unit ${missing.join(", ")}`);
  const perMid = new Map<string, number[]>();
  for (const u of byUnit.values()) if (u.when !== "CLASS") perMid.set(u.when, [...(perMid.get(u.when) ?? []), u.unit]);
  for (const [w, units] of perMid) if (units.length > 1) throw new CeaRuleError(`Only one unit can be held ${whenLabel(w as CeaWhen)} (units ${units.join(", ")})`);
  return [...byUnit.values()].sort((a, b) => a.unit - b.unit);
}

/** A unit-by-unit description of what changed, for the plan's history. */
export function planChanges(before: CeaPlanUnit[], after: CeaPlanUnit[], typeLabel: (id: string) => string): string {
  if (before.length === 0) return "Plan made";
  const out: string[] = [];
  for (const a of after) {
    const b = before.find((x) => x.unit === a.unit);
    if (!b || b.typeId !== a.typeId || b.when !== a.when) out.push(`Unit ${a.unit}: ${b ? `${typeLabel(b.typeId)} ${whenLabel(b.when)} -> ` : ""}${typeLabel(a.typeId)} ${whenLabel(a.when)}`);
  }
  return out.join("; ") || "No change";
}

/**
 * CEA marks of a student: the units' total (absent = 0, a unit not yet submitted = 0) scaled to the linked
 * component's max - rounded like a Mid component (nearest, half up). null when no unit has marks yet.
 */
export function scaleCea(unitMarks: (number | null)[], marksPerUnit: number, componentMax: number): number | null {
  const units = unitMarks.length;
  if (units === 0 || marksPerUnit <= 0 || unitMarks.every((m) => m == null)) return null;
  const total = unitMarks.reduce<number>((s, m) => s + (m ?? 0), 0);
  return scaleToComponent(total, units * marksPerUnit, componentMax);
}
