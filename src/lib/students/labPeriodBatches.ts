import type { DayOfWeek } from "@/types";
import { labPeriodKey, normalizeBatch } from "./labBatchMode";

// Periods where two (or more) labs of one section run side by side (Physics lab + Chemistry lab in Monday's
// periods 5-7): the class in-charge decides which batch goes to which lab, per period, the same every week. Stored
// per lab in SectionLabBatchSetting.batchByPeriod; effectiveLabBatch applies it. Pure helpers here.

export interface LabPeriod {
  key: string;
  day: DayOfWeek;
  periodNumber: number;
  /** The labs in this period (2+), each with the batch chosen for it (null = not chosen). */
  labs: { subjectId: string; subjectName: string; subjectCode: string; batch: string | null }[];
}

const DAY_ORDER: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** The periods of the section's timetable where 2+ different labs run, in week order. */
export function sideBySideLabPeriods(
  slots: { day: DayOfWeek; periodNumber: number; subjectId: string }[],
  labs: { subjectId: string; subjectName: string; subjectCode: string; batchByPeriod?: Record<string, string> }[],
): LabPeriod[] {
  const labById = new Map(labs.map((l) => [l.subjectId, l]));
  const byKey = new Map<string, { day: DayOfWeek; periodNumber: number; subjects: Set<string> }>();
  for (const s of slots) {
    if (!labById.has(s.subjectId)) continue;
    const key = labPeriodKey(s.day, s.periodNumber);
    const row = byKey.get(key) ?? { day: s.day, periodNumber: s.periodNumber, subjects: new Set<string>() };
    row.subjects.add(s.subjectId);
    byKey.set(key, row);
  }
  return [...byKey.entries()]
    .filter(([, r]) => r.subjects.size >= 2)
    .map(([key, r]) => ({
      key, day: r.day, periodNumber: r.periodNumber,
      labs: [...r.subjects].map((id) => {
        const l = labById.get(id)!;
        return { subjectId: id, subjectName: l.subjectName, subjectCode: l.subjectCode, batch: l.batchByPeriod?.[key] ?? null };
      }).sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
    }))
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.periodNumber - b.periodNumber);
}

/**
 * Checks one save: period key -> subjectId -> batch (blank / null = not chosen). Every key must be a side-by-side
 * period and every subject one of its labs; every batch one of the section's; two labs of one period can't take the
 * same batch. Returns the cleaned choice (canonical batch labels) or an error message.
 */
export function cleanPeriodChoices(
  input: unknown,
  periods: LabPeriod[],
  batches: string[],
): { ok: true; choices: Record<string, Record<string, string | null>> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Nothing to save." };
  const byKey = new Map(periods.map((p) => [p.key, p]));
  const canonical = new Map(batches.map((b) => [normalizeBatch(b), b]));
  const out: Record<string, Record<string, string | null>> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const period = byKey.get(key);
    if (!period) return { ok: false, error: "That period no longer has two labs side by side. Reload the page." };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Nothing to save." };
    const labIds = new Set(period.labs.map((l) => l.subjectId));
    const seen = new Map<string, string>();
    const row: Record<string, string | null> = {};
    for (const [subjectId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!labIds.has(subjectId)) return { ok: false, error: "That lab does not run in this period. Reload the page." };
      const wanted = typeof value === "string" ? value.trim() : "";
      if (!wanted) { row[subjectId] = null; continue; }
      const label = canonical.get(normalizeBatch(wanted));
      if (!label) return { ok: false, error: `"${wanted}" is not a batch of this section. Add it under Divide into batches first.` };
      const other = seen.get(normalizeBatch(label));
      if (other) {
        const name = (id: string) => period.labs.find((l) => l.subjectId === id)?.subjectName ?? "another lab";
        return { ok: false, error: `${label} can't go to both ${name(other)} and ${name(subjectId)} in the same period.` };
      }
      seen.set(normalizeBatch(label), subjectId);
      row[subjectId] = label;
    }
    out[key] = row;
  }
  return { ok: true, choices: out };
}
