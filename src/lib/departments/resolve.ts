// Single source of truth for "which department does this text/id mean" and for
// the normalisation that makes department names and short codes unique per
// college. Pure (no DB access) so server routes, client pages, scripts (via the
// mirrored logic in scripts/lib/departmentRefs.mjs) and tests share one rule.
//
// Identity model: `departmentId` (the Firestore doc id) is the permanent
// identity. `name` and `code` are unique per college, editable labels. A stored
// `department` string on any other document is only a display snapshot.

export interface DepartmentLike {
  id: string;
  name?: string;
  code?: string;
}

/**
 * Canonical comparison key for a department NAME: Unicode NFKC, every run of
 * whitespace (incl. NBSP / tabs / newlines) collapsed to one space, trimmed,
 * case-folded. "Computer  Science", "computer science " and "COMPUTER
 * SCIENCE" all share one key.
 */
export function normalizeDepartmentName(raw: string | undefined | null): string {
  return (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Canonical comparison key for a short CODE: NFKC, ALL whitespace removed, uppercased. */
export function normalizeDepartmentCode(raw: string | undefined | null): string {
  return (raw ?? "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

/** The form a department name is STORED in: NFKC, whitespace collapsed, trimmed, case preserved. */
export function canonicalDepartmentName(raw: string | undefined | null): string {
  return (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** The form a department code is STORED in (same as normalize - codes are stored uppercase, no spaces). */
export function canonicalDepartmentCode(raw: string | undefined | null): string {
  return normalizeDepartmentCode(raw);
}

export interface DepartmentIndex {
  byId: Map<string, DepartmentLike>;
  /** normalized name -> every department with that name (length > 1 means pre-existing bad data). */
  byName: Map<string, DepartmentLike[]>;
  /** normalized code -> every department with that code. */
  byCode: Map<string, DepartmentLike[]>;
}

export function buildDepartmentIndex(departments: DepartmentLike[]): DepartmentIndex {
  const byId = new Map<string, DepartmentLike>();
  const byName = new Map<string, DepartmentLike[]>();
  const byCode = new Map<string, DepartmentLike[]>();
  const push = (m: Map<string, DepartmentLike[]>, k: string, d: DepartmentLike) => {
    if (!k) return;
    const arr = m.get(k);
    if (arr) arr.push(d);
    else m.set(k, [d]);
  };
  for (const d of departments) {
    byId.set(d.id, d);
    push(byName, normalizeDepartmentName(d.name), d);
    push(byCode, normalizeDepartmentCode(d.code), d);
  }
  return { byId, byName, byCode };
}

export type DepartmentMatchKind = "id" | "name" | "code";

export type ResolveResult =
  | { ok: true; id: string; name: string; via: DepartmentMatchKind }
  | { ok: false; reason: "blank" | "none" | "ambiguous"; candidates?: string[] };

/**
 * Resolves raw text to a department. Order: exact id -> name -> code. A value
 * that matches more than one department (two departments sharing a name, or
 * one department's name equal to another's code) is `ambiguous` - never guessed.
 */
export function resolveDepartmentId(index: DepartmentIndex, raw: string | undefined | null): ResolveResult {
  const text = (raw ?? "").toString();
  if (!text.trim()) return { ok: false, reason: "blank" };

  const direct = index.byId.get(text.trim());
  if (direct) return { ok: true, id: direct.id, name: direct.name ?? "", via: "id" };

  const nameHits = index.byName.get(normalizeDepartmentName(text)) ?? [];
  const codeHits = index.byCode.get(normalizeDepartmentCode(text)) ?? [];
  const unique = new Map<string, { d: DepartmentLike; via: DepartmentMatchKind }>();
  for (const d of nameHits) unique.set(d.id, { d, via: "name" });
  for (const d of codeHits) if (!unique.has(d.id)) unique.set(d.id, { d, via: "code" });

  if (unique.size === 0) return { ok: false, reason: "none" };
  if (unique.size > 1) return { ok: false, reason: "ambiguous", candidates: [...unique.keys()] };
  const [{ d, via }] = unique.values();
  return { ok: true, id: d.id, name: d.name ?? "", via };
}

/** Display name for an id ("" when the id is unknown). */
export function departmentNameOf(index: DepartmentIndex, id: string | undefined | null): string {
  return (id && index.byId.get(id)?.name) || "";
}

export type DepartmentConflict =
  | { field: "name"; existingId: string; message: string }
  | { field: "code"; existingId: string; message: string };

/**
 * Uniqueness check for a create (`selfId` undefined) or rename/re-code
 * (`selfId` = the department being edited, excluded from the comparison so
 * re-saving its own value or changing only case/whitespace is allowed).
 * Rejects: same normalized name, same normalized code, a name equal to another
 * department's code, or a code equal to another department's name.
 */
export function findDepartmentConflict(
  departments: DepartmentLike[],
  candidate: { name?: string; code?: string },
  selfId?: string
): DepartmentConflict | null {
  const nName = candidate.name !== undefined ? normalizeDepartmentName(candidate.name) : "";
  const nCode = candidate.code !== undefined ? normalizeDepartmentCode(candidate.code) : "";
  // A name is compared to codes in code-space (whitespace-free, uppercased) and vice versa.
  const nameAsCode = candidate.name !== undefined ? normalizeDepartmentCode(candidate.name) : "";
  const codeAsName = candidate.code !== undefined ? normalizeDepartmentName(candidate.code) : "";
  for (const d of departments) {
    if (d.id === selfId) continue;
    const dName = normalizeDepartmentName(d.name);
    const dCode = normalizeDepartmentCode(d.code);
    if (nName && dName === nName) {
      return { field: "name", existingId: d.id, message: `A department named "${canonicalDepartmentName(candidate.name)}" already exists` };
    }
    if (nCode && dCode === nCode) {
      return { field: "code", existingId: d.id, message: `Short code "${nCode}" is already used by another department` };
    }
    if (nameAsCode && dCode && dCode === nameAsCode) {
      return { field: "name", existingId: d.id, message: `"${canonicalDepartmentName(candidate.name)}" is already used as another department's short code` };
    }
    if (codeAsName && dName && dName === codeAsName) {
      return { field: "code", existingId: d.id, message: `Short code "${nCode}" matches another department's name` };
    }
  }
  return null;
}
