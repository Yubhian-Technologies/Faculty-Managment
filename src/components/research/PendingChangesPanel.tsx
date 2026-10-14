"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// "What changed since this was verified?" - shown to whoever has to verify an
// edited record again (R&D, the department's R&D Coordinator).
//
// The server stores the exact difference from the last verified version on the
// record (`pendingChanges`, see lib/research/changeTracking.ts): which field,
// what it said when verified, what it says now. This only displays it.

interface FieldChange { key: string; label: string; before: string; after: string }
interface PendingChangesData {
  changedAt?: unknown;
  changedByName?: string;
  changes?: FieldChange[];
}

/** The trail on a record, or null when it was never edited after verification. */
export function readPendingChanges(record: unknown): { changes: FieldChange[]; changedByName: string; changedOn: string } | null {
  const raw = (record as { pendingChanges?: PendingChangesData } | null | undefined)?.pendingChanges;
  if (!raw || !Array.isArray(raw.changes)) return null;
  const t = raw.changedAt as { toDate?: () => Date; _seconds?: number } | string | undefined;
  const date = typeof t === "string" ? new Date(t)
    : typeof t?.toDate === "function" ? t.toDate()
      : typeof t?._seconds === "number" ? new Date(t._seconds * 1000)
        : null;
  return {
    changes: raw.changes,
    changedByName: raw.changedByName ?? "The submitter",
    changedOn: date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "",
  };
}

function ChangesTable({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        It was edited, but every field has the same value as the verified version.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Verified value</th>
            <th className="px-3 py-2 font-medium">Now</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.key} className="border-t align-top">
              <td className="px-3 py-2 font-medium whitespace-nowrap">{c.label}</td>
              <td className="px-3 py-2 text-muted-foreground break-words whitespace-pre-wrap">
                {c.before || <span className="italic">empty</span>}
              </td>
              <td className="px-3 py-2 break-words whitespace-pre-wrap">
                {c.after || <span className="italic text-muted-foreground">cleared</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Full-width panel for a record page. Renders nothing for an unedited record. */
export function PendingChangesPanel({ record }: { record: unknown }) {
  const trail = readPendingChanges(record);
  if (!trail) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-amber-700" />
        <p className="text-sm font-semibold">Edited after verification - changes to check</p>
        <Badge variant="pending" className="text-xs">
          {trail.changes.length} field{trail.changes.length === 1 ? "" : "s"} changed
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {trail.changedByName}{trail.changedOn ? ` edited this on ${trail.changedOn}` : " edited this"}. Compared with the version that was last verified.
      </p>
      <ChangesTable changes={trail.changes} />
    </div>
  );
}

/** Small button for list rows: opens the same table in a dialog. Renders nothing for an unedited record. */
export function ChangedFieldsButton({ record }: { record: unknown }) {
  const [open, setOpen] = useState(false);
  const trail = readPendingChanges(record);
  if (!trail) return null;
  return (
    <>
      <Button
        variant="ghost" size="sm" className="text-amber-700 hover:text-amber-700"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <History className="h-4 w-4 mr-1" />Changes ({trail.changes.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Changes since last verification</DialogTitle>
            <DialogDescription>
              {trail.changedByName}{trail.changedOn ? ` edited this on ${trail.changedOn}` : " edited this"}.
            </DialogDescription>
          </DialogHeader>
          <ChangesTable changes={trail.changes} />
        </DialogContent>
      </Dialog>
    </>
  );
}
