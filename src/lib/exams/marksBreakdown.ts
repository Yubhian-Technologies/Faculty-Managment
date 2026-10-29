import type { ExamConfigComponent } from "@/types";

// The internal marks breakdown sent by a form, checked: positive internal max,
// non-negative external max, named components with positive marks whose active
// total equals the internal max. Same rules as the branch configuration.

export type ComponentInput = Partial<ExamConfigComponent> & { name?: string; maxMarks?: number };

export function checkMarksBreakdown(input: { internalMaxMarks?: unknown; externalMaxMarks?: unknown; components?: unknown }):
  { ok: false; error: string } | { ok: true; internalMaxMarks: number; externalMaxMarks: number; components: ExamConfigComponent[] } {
  const internal = Number(input.internalMaxMarks), external = Number(input.externalMaxMarks);
  if (!Number.isFinite(internal) || internal <= 0) return { ok: false, error: "Internal Maximum Marks must be a positive number" };
  if (!Number.isFinite(external) || external < 0) return { ok: false, error: "External Maximum Marks must be a non-negative number" };
  const list = Array.isArray(input.components) ? (input.components as ComponentInput[]) : [];
  if (list.length === 0) return { ok: false, error: "At least one internal marks component is required" };
  for (const c of list) {
    if (!String(c.name ?? "").trim()) return { ok: false, error: "Every component needs a name" };
    if (typeof c.maxMarks !== "number" || c.maxMarks <= 0) return { ok: false, error: `"${c.name}" needs a positive maximum marks value` };
  }
  const total = list.filter((c) => c.isActive !== false).reduce((n, c) => n + (c.maxMarks ?? 0), 0);
  if (total !== internal) return { ok: false, error: `Breakdown total must equal the Internal Maximum Marks (${internal}). Current total: ${total}.` };
  return {
    ok: true, internalMaxMarks: internal, externalMaxMarks: external,
    components: list.map((c, i) => ({
      id: c.id || `c${i}_${Date.now().toString(36)}`, name: String(c.name).trim(), maxMarks: c.maxMarks!,
      ...(String(c.description ?? "").trim() ? { description: String(c.description).trim() } : {}),
      order: c.order ?? i, isActive: c.isActive !== false,
    })),
  };
}
