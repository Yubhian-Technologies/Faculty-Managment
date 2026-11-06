import { partMax } from "./pattern";
import type { PaperPrintLayout, PaperPartDef } from "@/types";

// The print layout the Exam Cell picks at print time (pure, shared by the page and the server).

export const PART_MAX_DURATION = 300;

/** The default per-part header: the paper's time, and the part's own max marks. */
export function defaultPartHeaders(parts: PaperPartDef[], durationMinutes: number): NonNullable<PaperPrintLayout["parts"]> {
  return parts.map((p) => ({ partId: p.id, durationMinutes, maxMarks: partMax(p) }));
}

/** Cleans a layout from a request: separate parts need a whole time (1-300 min) and max marks (>= 1) for each part. */
export function cleanPrintLayout(raw: unknown, parts: PaperPartDef[], durationMinutes: number): { value: PaperPrintLayout; errors: string[] } {
  const r = (raw ?? {}) as { separateParts?: unknown; parts?: unknown };
  if (r.separateParts !== true) return { value: { separateParts: false }, errors: [] };
  if (parts.length < 2) return { value: { separateParts: false }, errors: [] };
  const given = Array.isArray(r.parts) ? (r.parts as { partId?: unknown; durationMinutes?: unknown; maxMarks?: unknown }[]) : [];
  const defaults = defaultPartHeaders(parts, durationMinutes);
  const errors: string[] = [];
  const out = parts.map((p, i) => {
    const g = given.find((x) => x?.partId === p.id);
    const d = Number(g?.durationMinutes ?? defaults[i].durationMinutes);
    const m = Number(g?.maxMarks ?? defaults[i].maxMarks);
    if (!Number.isInteger(d) || d < 1 || d > PART_MAX_DURATION) errors.push(`${p.label}: time must be 1-${PART_MAX_DURATION} minutes`);
    if (!Number.isInteger(m) || m < 1 || m > 1000) errors.push(`${p.label}: max marks must be a whole number`);
    return { partId: p.id, durationMinutes: d, maxMarks: m };
  });
  return { value: { separateParts: true, parts: out }, errors };
}
