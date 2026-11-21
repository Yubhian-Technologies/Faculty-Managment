// A subject taught in two parts by two departments (e.g. Basic Electrical & Electronics Engineering: units 1-3
// Electrical by EEE, units 4-6 Electronics by ECE). Set by Academics on the Curriculum Subjects list.
//  - Each part has a name, its units and its department; every unit is in exactly one part.
//  - Each section has its own order (`partFirst[sectionId]`, default "A"): Mid 1 covers the part taught first,
//    Mid 2 the other - so ECE-A may write Electrical in Mid 1 while ECE-B writes Electronics.
//  - Each faculty row teaching the subject in a section carries the part it teaches (`teachingAssignments.part`).
// Pure - shared by the routes, the Curriculum screen and the Mid code.

export type PartKey = "A" | "B";
export const PART_KEYS: PartKey[] = ["A", "B"];

export interface SubjectPart {
  key: PartKey;
  name: string;
  units: number[];
  departmentId: string;
  departmentName: string;
}

/** Most units a parted subject may have (both parts together). */
export const MAX_PART_UNITS = 12;
const NAME_MAX = 60;

export const isPartKey = (v: unknown): v is PartKey => v === "A" || v === "B";

/** "1-3" / "1,2,3" / "4 - 6, 8" -> [1,2,3] ... ; null when unreadable. */
export function parseUnitList(text: string): number[] | null {
  const out: number[] = [];
  for (const raw of String(text ?? "").split(",")) {
    const piece = raw.trim();
    if (!piece) continue;
    const m = /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/.exec(piece);
    if (!m) return null;
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    if (b < a) return null;
    for (let u = a; u <= b; u++) out.push(u);
  }
  return out.length ? [...new Set(out)].sort((x, y) => x - y) : null;
}

/** [1,2,3,5] -> "1-3, 5" */
export function unitListLabel(units: number[]): string {
  const s = [...new Set(units)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(", ");
}

/**
 * Checks the two parts as sent by the Curriculum screen: exactly two, a name each, units 1..N with every unit in
 * exactly one part (no gaps), a department each. `departments` = id -> name of the college's departments;
 * `unitCount` = the frozen syllabus' unit count when there is one (the parts must cover exactly those units).
 */
export function cleanSubjectParts(
  raw: unknown,
  departments: Map<string, string>,
  unitCount?: number | null,
): { parts: SubjectPart[]; error: string } {
  const fail = (error: string) => ({ parts: [] as SubjectPart[], error });
  if (!Array.isArray(raw) || raw.length !== 2) return fail("A subject taught in parts has exactly two parts.");
  const parts: SubjectPart[] = [];
  for (let i = 0; i < 2; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>;
    const label = `Part ${PART_KEYS[i]}`;
    const name = String(r.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) return fail(`Enter a name for ${label} (for example Electrical).`);
    if (name.length > NAME_MAX) return fail(`${label}'s name is too long (at most ${NAME_MAX} characters).`);
    if (/\s\+\s/.test(name) || /\(Part [AB]\)/i.test(name)) return fail(`${label}'s name can't contain " + " or "(Part A/B)".`);
    const units = Array.isArray(r.units) ? [...new Set(r.units.map(Number))].sort((a, b) => a - b) : parseUnitList(String(r.units ?? ""));
    if (!units || units.length === 0) return fail(`Enter ${label}'s units (for example 1-3).`);
    if (units.some((u) => !Number.isInteger(u) || u < 1 || u > MAX_PART_UNITS)) return fail(`${label}'s units must be numbers from 1 to ${MAX_PART_UNITS}.`);
    const departmentId = String(r.departmentId ?? "").trim();
    if (!departmentId) return fail(`Select ${label}'s department.`);
    const departmentName = departments.get(departmentId);
    if (!departmentName) return fail(`${label}'s department was not found. It may have been deleted.`);
    parts.push({ key: PART_KEYS[i], name, units, departmentId, departmentName });
  }
  if (parts[0].name.toLowerCase() === parts[1].name.toLowerCase()) return fail("Give the two parts different names.");
  const shared = parts[0].units.filter((u) => parts[1].units.includes(u));
  if (shared.length) return fail(`Unit ${shared.join(", ")} is in both parts - each unit belongs to one part.`);
  const all = [...parts[0].units, ...parts[1].units].sort((a, b) => a - b);
  const total = unitCount && unitCount > 0 ? unitCount : all[all.length - 1];
  const missing = Array.from({ length: total }, (_, i) => i + 1).filter((u) => !all.includes(u));
  if (missing.length) return fail(`Unit ${missing.join(", ")} is in neither part - every unit belongs to one part.`);
  const extra = all.filter((u) => u > total);
  if (extra.length) return fail(`The frozen syllabus has ${total} units - unit ${extra.join(", ")} doesn't exist.`);
  return { parts, error: "" };
}

/** The subject's parts when it is taught in parts (two of them), else null. */
export function partsOf(subject: { parts?: SubjectPart[] | null } | null | undefined): SubjectPart[] | null {
  const p = subject?.parts;
  return Array.isArray(p) && p.length === 2 ? p : null;
}

/** Which part a section takes first (default A). */
export function firstPartFor(subject: { partFirst?: Record<string, PartKey> | null } | null | undefined, sectionId: string): PartKey {
  const v = subject?.partFirst?.[sectionId];
  return isPartKey(v) ? v : "A";
}

/** The part a section writes in Mid `mid` (1 = the part taught first, 2 = the other); null for other Mids. */
export function partForMid(parts: SubjectPart[], first: PartKey, mid: number): SubjectPart | null {
  if (mid !== 1 && mid !== 2) return null;
  const key: PartKey = mid === 1 ? first : first === "A" ? "B" : "A";
  return parts.find((p) => p.key === key) ?? null;
}

/**
 * The units a section's Mid covers for a subject taught in parts, with the part; null when the subject isn't taught
 * in parts (the usual Mid unit split applies).
 */
export function sectionMidPart(
  subject: { parts?: SubjectPart[] | null; partFirst?: Record<string, PartKey> | null },
  sectionId: string,
  mid: number,
): SubjectPart | null {
  const parts = partsOf(subject);
  if (!parts) return null;
  return partForMid(parts, firstPartFor(subject, sectionId), mid);
}

/** "Electrical (units 1-3)" */
export function partLabel(p: Pick<SubjectPart, "name" | "units">): string {
  return `${p.name} (unit${p.units.length === 1 ? "" : "s"} ${unitListLabel(p.units)})`;
}

// ---- Mid papers per part ---------------------------------------------------------------------------------------
// For a subject taught in parts, the Mid paper flow (setters, papers, approval, the Exam Cell's choice, the printed
// paper, marks) works per PART instead of per branch: the paper "branch" of the part is `partBranchLabel(part)` and
// it covers every section (any branch) writing that part in this Mid. Its HOD is the part's department's.

/** The paper scope label of a part: "Electrical (Part A)". */
export const partBranchLabel = (p: Pick<SubjectPart, "name" | "key">) => `${p.name} (Part ${p.key})`;

/** The part a paper scope label stands for (null = a real branch / not a parted subject). */
export function partOfBranch(subject: { parts?: SubjectPart[] | null } | null | undefined, branch: string): SubjectPart | null {
  const parts = partsOf(subject);
  return parts?.find((p) => partBranchLabel(p) === branch) ?? null;
}

/** The paper scope a section's Mid falls under: its part's label for a parted subject, else its own branch. */
export function midPaperBranch(
  subject: { parts?: SubjectPart[] | null; partFirst?: Record<string, PartKey> | null } | null | undefined,
  sectionId: string,
  realBranch: string,
  mid: number,
): string {
  const part = subject ? sectionMidPart(subject, sectionId, mid) : null;
  return part ? partBranchLabel(part) : realBranch;
}

/**
 * The Mid -> units split for a paper of one part (the Mid units setup takes it as the subject's exception): this Mid
 * covers the part's units, the other Mid the other part's. null when `branch` isn't a part of the subject.
 */
export function partUnitSplit(subject: { parts?: SubjectPart[] | null } | null | undefined, branch: string, midNumber: number): Record<string, number[]> | null {
  const parts = partsOf(subject);
  const part = partOfBranch(subject, branch);
  if (!parts || !part || (midNumber !== 1 && midNumber !== 2)) return null;
  const other = parts.find((p) => p.key !== part.key)!;
  return { [String(midNumber)]: part.units, [String(midNumber === 1 ? 2 : 1)]: other.units };
}

/**
 * A paper filed per branch (a Mid prepared before the subject went into parts) whose sections ALL write the same part
 * in this Mid: that part's split (so the paper covers the part they were taught). null otherwise.
 */
export function partSplitForSections(
  subject: { parts?: SubjectPart[] | null; partFirst?: Record<string, PartKey> | null } | null | undefined,
  sectionIds: string[],
  midNumber: number,
): Record<string, number[]> | null {
  const parts = partsOf(subject);
  if (!parts || sectionIds.length === 0 || (midNumber !== 1 && midNumber !== 2)) return null;
  const keys = new Set(sectionIds.map((id) => sectionMidPart(subject!, id, midNumber)?.key));
  if (keys.size !== 1) return null;
  const part = parts.find((p) => p.key === [...keys][0]);
  if (!part) return null;
  return partUnitSplit(subject, partBranchLabel(part), midNumber);
}
