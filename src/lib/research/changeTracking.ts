import { FieldValue } from "firebase-admin/firestore";
import { RESEARCH_FIELD_LABELS } from "@/lib/research/fieldLabels";

// "What did they change after it was verified?"
//
// Editing a record that R&D already APPROVED sends it back for verification.
// Without a trail the reviewer is handed a record that looks like any other and
// has to re-read every field to find what moved. So the first edit of an
// approved record stores the verified values (`verifiedSnapshot`) and every
// edit after that stores the exact difference from them (`pendingChanges`):
// which field, what it said when it was verified, what it says now.
//
// The comparison is always against the LAST VERIFIED version, never the
// previous edit - three small edits in a row must show as one combined diff,
// and an edit that puts a value back must show as no change at all. Approval
// deletes both fields (the new values are now the verified ones).
//
// Only records that were once approved get a trail: a first submission has
// nothing to be compared with.

export interface FieldChange {
  key: string;
  label: string;
  /** Display text of the value when it was last verified ("" = was empty). */
  before: string;
  /** Display text of the value now ("" = cleared). */
  after: string;
}

export interface PendingChanges {
  changedAt: Date;
  changedBy: string;
  changedByName: string;
  changes: FieldChange[];
}

const MAX_TEXT = 600;

function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isTimestampLike(v: unknown): v is { toDate: () => Date } {
  return typeof v === "object" && v !== null && typeof (v as { toDate?: unknown }).toDate === "function";
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.every(isEmpty);
  if (typeof v === "object" && !isTimestampLike(v)) return Object.values(v as object).every(isEmpty);
  return false;
}

/** A value as a reviewer would read it - never JSON, never "[object Object]". */
export function displayValue(v: unknown, labels: Record<string, string> = {}): string {
  if (isEmpty(v)) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (isTimestampLike(v)) return v.toDate().toISOString().slice(0, 10);
  if (Array.isArray(v)) {
    return v.filter((i) => !isEmpty(i)).map((i) => displayValue(i, labels)).join("; ");
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, iv]) => !isEmpty(iv))
      .map(([k, iv]) => `${labels[k] ?? humanize(k)}: ${displayValue(iv, labels)}`)
      .join(", ");
  }
  return String(v);
}

function clip(s: string): string {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

/** Treats null / undefined / "" / [] as the same "nothing", and Timestamps by value. */
function normalise(v: unknown): unknown {
  if (isEmpty(v)) return null;
  if (isTimestampLike(v)) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(normalise);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const n = normalise((v as Record<string, unknown>)[k]);
      if (n !== null) out[k] = n;
    }
    return out;
  }
  return v;
}

/**
 * Record keys that are plumbing, not something a submitter typed: routing,
 * review bookkeeping, ownership, and the trail itself. Anything else a record
 * holds is content, so a field added to a form is tracked with no change here.
 */
const BOOKKEEPING = new Set([
  "id", "collegeId", "uid", "ownerName", "ownerRole", "ownerDesignation", "facultyId",
  "status", "reviewedBy", "reviewedByName", "reviewedAt", "rejectionReason",
  "sentBackReason", "coordinatorNote", "coordinatorUid", "coordinatorReviewedBy",
  "coordinatorReviewedByName", "coordinatorReviewedAt", "coordinatorEdits", "reviewDepartment",
  "addedBy", "addedByName", "createdAt", "updatedAt", "changeLog",
  "verifiedSnapshot", "pendingChanges", "internalAuthorUids",
]);

/** The content of a record: every key that is not bookkeeping, as plain data. */
export function contentOf(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (BOOKKEEPING.has(k) || v === undefined) continue;
    // A FieldValue sentinel (delete / arrayUnion ...) is a write instruction, not content.
    if (typeof v === "object" && v !== null && !Array.isArray(v) && !isTimestampLike(v)
      && typeof (v as { isEqual?: unknown }).isEqual === "function") continue;
    out[k] = v;
  }
  return out;
}

export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  moduleSlug: string,
): FieldChange[] {
  const labels = RESEARCH_FIELD_LABELS[moduleSlug] ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: FieldChange[] = [];
  for (const key of keys) {
    if (same(before[key], after[key])) continue;
    changes.push({
      key,
      label: labels[key] ?? humanize(key),
      before: clip(displayValue(before[key], labels)),
      after: clip(displayValue(after[key], labels)),
    });
  }
  return changes;
}

/** "Venue, End Date and 2 more" - for notification text. */
export function summarizeFieldChanges(changes: FieldChange[], max = 3): string {
  if (changes.length === 0) return "no field values differ from the verified version";
  const names = changes.slice(0, max).map((c) => c.label);
  const rest = changes.length - names.length;
  return rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
}

export interface EditTrailInput {
  /** The record as stored BEFORE this edit. */
  existing: Record<string, unknown>;
  /** The values this edit writes (bookkeeping keys in it are ignored). */
  incoming: Record<string, unknown>;
  moduleSlug: string;
  editorUid: string;
  editorName: string;
  now: Date;
}

export interface EditTrail {
  /** Fields to spread into the update; `{}` when the record was never verified. */
  updates: Record<string, unknown>;
  /** The exact differences from the verified version ([] when nothing was ever verified). */
  changes: FieldChange[];
  /** True when this edit reopens an already-verified record. */
  reopened: boolean;
}

/**
 * What an owner's edit must additionally write so the reviewer can see exactly
 * what changed since the last verification.
 *
 * `existing.status === "APPROVED"` starts a trail (the stored values ARE the
 * verified ones); a leftover `verifiedSnapshot` continues one across a rejection
 * or a second edit.
 */
export function buildEditTrail(input: EditTrailInput): EditTrail {
  const { existing, incoming, moduleSlug, editorUid, editorName, now } = input;
  const reopened = existing.status === "APPROVED";
  const stored = existing.verifiedSnapshot as Record<string, unknown> | undefined;
  const baseline = stored && typeof stored === "object" ? stored : reopened ? contentOf(existing) : null;
  if (!baseline) return { updates: {}, changes: [], reopened: false };

  const after = { ...contentOf(existing), ...contentOf(incoming) };
  const changes = diffFields(baseline, after, moduleSlug);
  const pending: PendingChanges = { changedAt: now, changedBy: editorUid, changedByName: editorName, changes };
  return {
    updates: { verifiedSnapshot: baseline, pendingChanges: pending },
    changes,
    reopened,
  };
}

/** Spread into the approval write: the new values are the verified ones now. */
export function clearEditTrail(): Record<string, unknown> {
  return { verifiedSnapshot: FieldValue.delete(), pendingChanges: FieldValue.delete() };
}
