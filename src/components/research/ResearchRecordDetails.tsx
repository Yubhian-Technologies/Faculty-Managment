"use client";

import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

// Read-only "everything the submitter entered" view for a Research & Innovation
// record, shared by every module's record page (/r-and-d/record/[module]/[id]).
//
// The R&D list pages show a deliberately narrow table (owner, title, a couple of
// identifying columns) - fine for scanning, but R&D has to APPROVE or REJECT
// these, and most of what a submitter fills in never appeared on that table.
// Rather than widen eleven tables, or hand-write eleven field lists that would
// silently fall behind every new field added to the forms, this renders whatever
// the record actually holds.
//
// That generality is the point: a field added to any research form shows up here
// the moment it is saved, with no change to this file.
//
// Rendering is RECURSIVE because these records are not flat. A publication keeps
// its real content in a nested `details` object (with `authors`, `sdgGoals`,
// `indexedIn` inside it) alongside the legacy flat fields derived from it; an
// IPR carries arrays of applicants and inventors. Anything not handled
// structurally would land in front of a reviewer as a JSON blob.
//
// Layout: short values go in a responsive grid rather than one row each, because
// a sponsored project has ~40 fields and a single tall column forces a reviewer
// to scroll past most of them. Long prose and nested groups still span the full
// width, so they stay readable.

/** Record keys that are plumbing, not something a reviewer needs to read. */
const HIDDEN_KEYS = new Set([
  "id", "collegeId", "uid", "ownerUid", "facultyId",
  // Shown in the page header instead.
  "ownerName", "ownerRole", "ownerDesignation",
  // Review bookkeeping - the reviewer is the one acting, and the page already
  // shows status and any rejection reason above these fields.
  "status", "reviewedBy", "reviewedByName", "reviewedAt", "rejectionReason",
  "addedBy", "addedByName", "createdAt", "updatedAt",
  // Internal join key, not a field anyone submitted.
  "internalAuthorUids",
]);

/** Values longer than this get their own full-width block rather than a cell. */
const LONG_VALUE_CHARS = 80;

/** "dateOfFiling" -> "Date Of Filing". Only a fallback - see RESEARCH_FIELD_LABELS. */
function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isUrlKey(key: string): boolean {
  return /(url|link)$/i.test(key);
}

/** A Firestore Timestamp, its JSON {_seconds} form, or nothing. */
function asDate(v: unknown): string | null {
  const t = v as { toDate?: () => Date; _seconds?: number } | undefined;
  const d = typeof t?.toDate === "function" ? t.toDate()
    : typeof t?._seconds === "number" ? new Date(t._seconds * 1000)
      : null;
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object" && !asDate(v)) return Object.keys(v as object).length === 0;
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !asDate(v);
}

/** A scalar, rendered for its key (links for *Url / *Link fields holding a URL). */
function Scalar({ fieldKey, v }: { fieldKey: string; v: unknown }) {
  if (typeof v === "string" && v && isUrlKey(fieldKey) && /^https?:\/\//i.test(v)) {
    return (
      <a
        href={v}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline break-all"
      >
        Open <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }
  if (typeof v === "boolean") return <>{v ? "Yes" : "No"}</>;
  const d = asDate(v);
  if (d) return <>{d}</>;
  return <>{String(v)}</>;
}

/** Label above value - reads better than label|value columns for short values. */
function Cell({ label, className, referenceUrl, children }: { label: string; className?: string; referenceUrl?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border bg-muted/20 px-3 py-2 ${className ?? ""}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
        {/* The same lookup source the submission form points at, so a
            reviewer can check the declared value against it. */}
        {referenceUrl && (
          <>
            {" "}
            <a href={referenceUrl} target="_blank" rel="noopener noreferrer" className="normal-case text-primary hover:underline">
              ({referenceUrl})
            </a>
          </>
        )}
      </p>
      <div className="text-sm mt-0.5 break-words">{children}</div>
    </div>
  );
}

/** A full-width titled group - nested objects and lists of objects. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sm:col-span-2 lg:col-span-3 rounded-lg border p-3">
      <p className="text-xs font-semibold mb-2">{label}</p>
      {children}
    </div>
  );
}

function looksLong(v: unknown): boolean {
  return typeof v === "string" && v.length > LONG_VALUE_CHARS;
}

/**
 * One key/value. Objects and arrays of objects recurse into Groups; everything
 * else becomes a Cell in the surrounding grid.
 */
function Entry({
  fieldKey, label, v, labels, renderers, referenceUrls,
}: {
  fieldKey: string; label: string; v: unknown;
  labels?: Record<string, string>;
  renderers?: Record<string, (value: unknown) => React.ReactNode>;
  referenceUrls?: Record<string, string>;
}) {
  // A module-supplied renderer wins over the structural defaults - used
  // where a raw value needs turning into something a reviewer can act on
  // (e.g. index codes becoming links to the indexing site).
  const custom = renderers?.[fieldKey];
  if (custom) {
    return <Cell label={label} referenceUrl={referenceUrls?.[fieldKey]}>{custom(v)}</Cell>;
  }

  // Array of objects: authors, applicants, inventors, co-PIs...
  if (Array.isArray(v) && v.some(isPlainObject)) {
    return (
      <Group label={`${label} (${v.length})`}>
        <div className="space-y-2">
          {v.map((item, i) => (
            <div key={i} className="rounded-md border bg-muted/20 p-2">
              {isPlainObject(item) ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(item)
                    .filter(([, iv]) => !isEmpty(iv))
                    .map(([ik, iv]) => (
                      <Entry key={ik} fieldKey={ik} label={labels?.[ik] ?? humanize(ik)} v={iv} labels={labels} renderers={renderers} referenceUrls={referenceUrls} />
                    ))}
                </div>
              ) : (
                <span className="text-sm">{String(item)}</span>
              )}
            </div>
          ))}
        </div>
      </Group>
    );
  }

  // Array of primitives: SDG goals, indexing lists, keywords...
  if (Array.isArray(v)) {
    return (
      <Cell label={label} referenceUrl={referenceUrls?.[fieldKey]}>
        <div className="flex flex-wrap gap-1 pt-0.5">
          {v.map((item, i) => (
            <Badge key={i} variant="secondary" className="text-xs font-normal">{String(item)}</Badge>
          ))}
        </div>
      </Cell>
    );
  }

  // Nested object: a publication's `details`, a project's funding block...
  if (isPlainObject(v)) {
    const inner = Object.entries(v).filter(([k, iv]) => !HIDDEN_KEYS.has(k) && !isEmpty(iv));
    if (inner.length === 0) return null;
    return (
      <Group label={label}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {inner.map(([ik, iv]) => (
            <Entry key={ik} fieldKey={ik} label={labels?.[ik] ?? humanize(ik)} v={iv} labels={labels} renderers={renderers} referenceUrls={referenceUrls} />
          ))}
        </div>
      </Group>
    );
  }

  // Prose (objectives, outcomes, problem statements) gets the full width.
  return (
    <Cell label={label} className={looksLong(v) ? "sm:col-span-2 lg:col-span-3" : undefined} referenceUrl={referenceUrls?.[fieldKey]}>
      <Scalar fieldKey={fieldKey} v={v} />
    </Cell>
  );
}

export interface ResearchRecordDetailsProps {
  /** The record to render. */
  record: Record<string, unknown>;
  /** Optional nicer labels for specific keys; anything absent is humanized. */
  labels?: Record<string, string>;
  /** Optional value formatters for specific keys (enum code -> label, etc). */
  formatters?: Record<string, (value: unknown) => string>;
  /** Optional custom value rendering for specific keys (links, chips, ...). */
  renderers?: Record<string, (value: unknown) => React.ReactNode>;
  /** Optional lookup-source URL shown beside a field's label, as the form does. */
  referenceUrls?: Record<string, string>;
}

export function ResearchRecordDetails({
  record, labels, formatters, renderers, referenceUrls,
}: ResearchRecordDetailsProps) {
  // Empty values are dropped rather than rendered as blank cells: an optional
  // field nobody filled in is noise on a review screen, and these records have
  // a lot of them (commercialization only applies to some IPRs, granted dates
  // only to granted ones, and so on).
  const entries = Object.entries(record).filter(([k, v]) => !HIDDEN_KEYS.has(k) && !isEmpty(v));

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">This record has no details recorded.</p>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(([k, v]) => {
        const label = labels?.[k] ?? humanize(k);
        const format = formatters?.[k];
        if (format) return <Cell key={k} label={label} referenceUrl={referenceUrls?.[k]}>{format(v)}</Cell>;
        return <Entry key={k} fieldKey={k} label={label} v={v} labels={labels} renderers={renderers} referenceUrls={referenceUrls} />;
      })}
    </div>
  );
}
