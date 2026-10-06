import type { PreviousTeachingAssignment, PreviousTeachingSource } from "@/types/core";

// Previous Teaching Assignments - the free-text record of teaching done earlier, at this college (Internal) or
// another one (External). Stored as `previousTeachingAssignments` on the facultyMembers doc. Everything here is
// pure (no firebase) so the edit pages, the API routes and the resume all use the same rules.

export const MAX_PREVIOUS_TEACHING_ROWS = 300;
const MAX_FIELD_LENGTH = 200;

export const PREVIOUS_TEACHING_SOURCE_LABELS: Record<PreviousTeachingSource, string> = {
  INTERNAL: "Internal",
  EXTERNAL: "External",
};

export function emptyPreviousTeaching(id: string): PreviousTeachingAssignment {
  return { id, source: "INTERNAL", collegeName: "", academicYear: "", course: "", year: "", semester: "", subject: "", passPercentage: "" };
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** A row with nothing filled in beyond the Internal/External pick - dropped on save rather than stored empty. */
function isBlankRow(r: Omit<PreviousTeachingAssignment, "id">): boolean {
  return !(r.collegeName || r.academicYear || r.course || r.year || r.semester || r.subject || r.passPercentage);
}

export type NormalizeResult =
  | { ok: true; value: PreviousTeachingAssignment[] }
  | { ok: false; error: string };

/**
 * Cleans a client-sent list: trims every field, keeps them free text, drops blank rows, requires a College Name on an
 * External row, caps lengths/rows and gives every row an id (`makeId` supplies one for a row that arrived without).
 */
export function normalizePreviousTeachingAssignments(input: unknown, makeId: () => string): NormalizeResult {
  if (!Array.isArray(input)) return { ok: false, error: "previousTeachingAssignments must be a list" };
  if (input.length > MAX_PREVIOUS_TEACHING_ROWS) return { ok: false, error: `At most ${MAX_PREVIOUS_TEACHING_ROWS} previous teaching assignments can be saved` };

  const out: PreviousTeachingAssignment[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const source: PreviousTeachingSource = r.source === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
    const row = {
      source,
      // College Name only means something for External - never kept on an Internal row.
      collegeName: source === "EXTERNAL" ? text(r.collegeName) : "",
      academicYear: text(r.academicYear), course: text(r.course), year: text(r.year), semester: text(r.semester),
      subject: text(r.subject), passPercentage: text(r.passPercentage),
    };
    if (isBlankRow(row)) continue;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "string" && v.length > MAX_FIELD_LENGTH) return { ok: false, error: `${k} is too long (max ${MAX_FIELD_LENGTH} characters)` };
    }
    if (source === "EXTERNAL" && !row.collegeName) return { ok: false, error: "College Name is required for an External previous teaching assignment" };
    let id = typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 80) : "";
    if (!id || seen.has(id)) id = makeId();
    seen.add(id);
    out.push({ id, ...row });
  }
  return { ok: true, value: out };
}

/**
 * The list to store after a save. When the editor says which ids it had loaded (`loadedIds`), a stored row it never
 * saw - added meanwhile by the HOD or the faculty member - is kept; only rows the editor loaded and then removed are
 * dropped, and a row both sides touched takes the editor's version. Without `loadedIds` the list replaces the stored one.
 */
export function mergePreviousTeachingAssignments(
  stored: PreviousTeachingAssignment[] | undefined,
  incoming: PreviousTeachingAssignment[],
  loadedIds: string[] | undefined,
): PreviousTeachingAssignment[] {
  if (!loadedIds) return incoming;
  const loaded = new Set(loadedIds);
  const incomingIds = new Set(incoming.map((r) => r.id));
  const unseen = (stored ?? []).filter((r) => r && !loaded.has(r.id) && !incomingIds.has(r.id));
  return [...incoming, ...unseen].slice(0, MAX_PREVIOUS_TEACHING_ROWS);
}

/** The ids a client may send as `previousTeachingAssignmentsLoadedIds` (anything else is ignored). */
export function parseLoadedIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter((v): v is string => typeof v === "string").slice(0, MAX_PREVIOUS_TEACHING_ROWS * 2);
}

/** "85" -> "85%"; "85%" and non-numeric text ("Pass") are shown as typed. */
export function formatPassPercentage(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return /^\d+(\.\d+)?$/.test(v) ? `${v}%` : v;
}

/** Stored rows for display (older/hand-edited docs may hold anything): only well-formed rows, never throws. */
export function readPreviousTeachingAssignments(doc: { previousTeachingAssignments?: unknown } | null | undefined): PreviousTeachingAssignment[] {
  const list = doc?.previousTeachingAssignments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw, i) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    return [{
      id: typeof r.id === "string" && r.id ? r.id : `prev_${i}`,
      source: r.source === "EXTERNAL" ? ("EXTERNAL" as const) : ("INTERNAL" as const),
      collegeName: text(r.collegeName), academicYear: text(r.academicYear), course: text(r.course), year: text(r.year),
      semester: text(r.semester), subject: text(r.subject), passPercentage: text(r.passPercentage),
    }];
  });
}

export type PreviousTeachingUpdate =
  | { kind: "none" }
  | { kind: "error"; error: string }
  | { kind: "set"; value: PreviousTeachingAssignment[] };

/**
 * What a PATCH body means for `previousTeachingAssignments`: nothing (key absent), an error (400), or the list to
 * write - cleaned, and merged with the stored one when the editor reported which ids it had loaded.
 */
export function resolvePreviousTeachingUpdate(
  body: { previousTeachingAssignments?: unknown; previousTeachingAssignmentsLoadedIds?: unknown },
  storedDoc: { previousTeachingAssignments?: unknown } | undefined,
  makeId: () => string,
): PreviousTeachingUpdate {
  if (body.previousTeachingAssignments === undefined) return { kind: "none" };
  const cleaned = normalizePreviousTeachingAssignments(body.previousTeachingAssignments, makeId);
  if (!cleaned.ok) return { kind: "error", error: cleaned.error };
  const merged = mergePreviousTeachingAssignments(
    readPreviousTeachingAssignments(storedDoc), cleaned.value, parseLoadedIds(body.previousTeachingAssignmentsLoadedIds),
  );
  return { kind: "set", value: merged };
}

/** The first thing wrong with a list the user is about to save (before any request is made), or null. */
export function previousTeachingProblem(rows: PreviousTeachingAssignment[]): string | null {
  const missingCollege = rows.some((r) => r.source === "EXTERNAL" && !(r.collegeName ?? "").trim() && !isBlankRow({ ...r }));
  return missingCollege ? "College Name is required for every External previous teaching assignment" : null;
}
