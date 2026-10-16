// Timetable signature authority: the designations printed under a published
// timetable (PDF, print and Excel). The college admin keeps groups of
// designations per college (colleges/{id}/settings/timetableSignatures) and
// ticks the designations to show; all ticked designations are printed side by side in one row of
// equally spaced signature blocks (group order, then the order added). Nothing ticked = the long-standing In-Charge / HOD / Principal row.

import { getHodSignatureLabel } from "@/lib/timetable/gridModel";

export interface SignatureDesignation {
  label: string;
  /** Printed on the timetable. */
  selected: boolean;
}

export interface SignatureGroup {
  id: string;
  /** Label the admin gave the group, e.g. "Group 1". Not printed. */
  name: string;
  designations: SignatureDesignation[];
}

export const MAX_SIGNATURE_GROUPS = 20;
export const MAX_DESIGNATIONS_PER_GROUP = 6;
export const MAX_DESIGNATION_LENGTH = 60;
export const MAX_GROUP_NAME_LENGTH = 40;

/** "A + B+C" -> ["A", "B", "C"]; blanks dropped. */
export function parseDesignations(text: string): string[] {
  return text
    .split("+")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Stored groups -> current shape. Groups saved by the first version held one
 * "A + B" text and a single group-level tick; they become designations that
 * are all ticked when the group was.
 */
export function readSignatureGroups(stored: unknown): SignatureGroup[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((raw, i) => {
    const g = (raw ?? {}) as { id?: string; name?: string; designations?: SignatureDesignation[]; text?: string; selected?: boolean };
    const designations = Array.isArray(g.designations)
      ? g.designations.map((d) => ({ label: String(d?.label ?? ""), selected: d?.selected === true }))
      : parseDesignations(g.text ?? "").map((label) => ({ label, selected: g.selected === true }));
    return { id: g.id ?? `g${i + 1}`, name: g.name ?? `Group ${i + 1}`, designations };
  });
}

/** Cleans a client-supplied list; returns an error string for the first problem. */
export function normalizeSignatureGroups(input: unknown): { groups: SignatureGroup[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "groups must be a list" };
  if (input.length > MAX_SIGNATURE_GROUPS) return { error: `At most ${MAX_SIGNATURE_GROUPS} groups are allowed` };
  const groups: SignatureGroup[] = [];
  for (const raw of input) {
    const g = (raw ?? {}) as Partial<SignatureGroup>;
    const list = Array.isArray(g.designations) ? g.designations : [];
    const designations: SignatureDesignation[] = [];
    const seen = new Set<string>();
    for (const d of list) {
      const label = (typeof d?.label === "string" ? d.label : "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      if (label.length > MAX_DESIGNATION_LENGTH) return { error: `A designation can be at most ${MAX_DESIGNATION_LENGTH} characters` };
      if (seen.has(label.toLowerCase())) return { error: `"${label}" is added twice in one group` };
      seen.add(label.toLowerCase());
      designations.push({ label, selected: d?.selected === true });
    }
    if (designations.length === 0) return { error: "Every group needs at least one designation" };
    if (designations.length > MAX_DESIGNATIONS_PER_GROUP) {
      return { error: `A group can hold at most ${MAX_DESIGNATIONS_PER_GROUP} designations` };
    }
    const name = (typeof g.name === "string" ? g.name.replace(/\s+/g, " ").trim() : "") || `Group ${groups.length + 1}`;
    if (name.length > MAX_GROUP_NAME_LENGTH) return { error: `A group name can be at most ${MAX_GROUP_NAME_LENGTH} characters` };
    const id = typeof g.id === "string" && /^[\w-]{1,40}$/.test(g.id) ? g.id : `g${groups.length + 1}_${Date.now().toString(36)}`;
    groups.push({ id, name, designations });
  }
  return { groups };
}

/**
 * Every ticked designation, across all groups, in one row - printed side by
 * side exactly like the default In-Charge / HOD / Principal row. Empty when
 * nothing is ticked.
 */
export function selectedSignatureRows(groups: SignatureGroup[] | undefined | null): string[][] {
  const row = (groups ?? []).flatMap((g) => g.designations.filter((d) => d.selected).map((d) => d.label));
  return row.length > 0 ? [row] : [];
}

/** The row printed when the college has ticked nothing. */
export function defaultSignatureRow(departmentName?: string): string[] {
  return ["TimeTable In-Charge", getHodSignatureLabel(departmentName), "PRINCIPAL"];
}

/**
 * Rows to print for one timetable. A bare "HOD" becomes the section's own
 * "HOD-<dept>" label, exactly as the default row does.
 */
export function resolveSignatureRows(rows: string[][] | undefined, departmentName?: string): string[][] {
  if (!rows || rows.length === 0) return [defaultSignatureRow(departmentName)];
  return rows.map((row) => row.map((label) => (label.trim().toLowerCase() === "hod" ? getHodSignatureLabel(departmentName) : label)));
}
