"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";

interface LabFaculty {
  facultyId: string;
  facultyName: string;
  /** The batch this faculty takes in this lab, or null. */
  batch: string | null;
  /** The dates this faculty teaches the lab (inclusive), or null = throughout. */
  window: { from: string; to: string } | null;
}

interface LabRow {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  // true = batch by batch, false = no batch (whole section together), null = no decision yet.
  batchWise: boolean | null;
  faculty: LabFaculty[];
}

const dmy = (d: string) => { const [y, m, day] = d.split("-"); return `${day}-${m}-${y}`; };
const sameBatch = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// For each lab (PRACTICAL subject) of a section: should its attendance run batch
// by batch, using the lab batches assigned above, or with no batch (the whole
// section together)? Batch-wise also lets each faculty of the lab take a batch.
// The section's faculty incharge presses Edit on a lab, ticks what they want, and
// Save writes it (Cancel throws the changes away). See SectionLabBatchSetting /
// lib/students/labBatchMode.ts for what it changes.
export function SectionLabBatchModes({ sectionId }: { sectionId: string }) {
  const [labs, setLabs] = useState<LabRow[]>([]);
  // The batches the incharge has already created (and saved) in this section.
  const [batches, setBatches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // The lab being edited and its unsaved changes (the saved copy stays in `labs` until Save).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LabRow | null>(null);
  const [saving, setSaving] = useState(false);
  // The faculty row opened to pick a batch - `${subjectId}::${facultyId}`.
  const [openFaculty, setOpenFaculty] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/college/section-lab-batch-settings?sectionId=${encodeURIComponent(sectionId)}`);
        const json = (await res.json()) as { labs?: LabRow[]; batches?: string[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load labs");
        if (!cancelled) {
          setLabs(json.labs ?? []);
          setBatches(json.batches ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setLabs([]);
          toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load labs" });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sectionId]);

  function startEdit(lab: LabRow) {
    setEditingId(lab.subjectId);
    setDraft({ ...lab, faculty: lab.faculty.map((f) => ({ ...f })) });
    setOpenFaculty(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setOpenFaculty(null);
  }

  // `next`: the new mode, or null to clear the decision (box unticked). "No batch" also clears the faculty batches.
  function draftMode(next: boolean | null) {
    setDraft((d) => d && ({
      ...d,
      batchWise: next,
      faculty: next === true ? d.faculty : d.faculty.map((f) => ({ ...f, batch: null })),
    }));
    if (next !== true) setOpenFaculty(null);
  }

  // A faculty's teaching dates: both empty = throughout. Either date can be typed first.
  function draftFacultyWindow(facultyId: string, patch: { from?: string; to?: string }) {
    setDraft((d) => d && ({
      ...d,
      faculty: d.faculty.map((f) => {
        if (f.facultyId !== facultyId) return f;
        const from = patch.from ?? f.window?.from ?? "";
        const to = patch.to ?? f.window?.to ?? "";
        return { ...f, window: from || to ? { from, to } : null };
      }),
    }));
  }

  function draftFacultyBatch(facultyId: string, batch: string | null) {
    setDraft((d) => d && ({ ...d, faculty: d.faculty.map((f) => (f.facultyId === facultyId ? { ...f, batch } : f)) }));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/section-lab-batch-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          subjectId: draft.subjectId,
          batchWise: draft.batchWise,
          ...(draft.batchWise === true
            ? { batchByFaculty: Object.fromEntries(draft.faculty.map((f) => [f.facultyId, f.batch])) }
            : {}),
          // Each faculty's teaching dates (empty = throughout), saved with the rest.
          windowByFaculty: Object.fromEntries(draft.faculty.map((f) => [f.facultyId, f.window])),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setLabs((prev) => prev.map((l) => (l.subjectId === draft.subjectId ? draft : l)));
      toast({ variant: "success", title: "Saved", description: draft.subjectName });
      cancelEdit();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Labs of this section</CardTitle>
        <CardDescription>
          Once the batches are assigned, decide for each lab: <strong>Batch-wise</strong> (each batch&apos;s faculty marks only their own students) or{" "}
          <strong>No batch</strong> (the whole section attends together). Press <strong>Edit</strong> on a lab, make your choice, then <strong>Save</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/30" />
        ) : labs.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No lab (practical) subject is assigned to this section yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {labs.map((saved) => {
              const isEditing = editingId === saved.subjectId && draft !== null;
              const lab = isEditing ? draft : saved;
              return (
                <div key={saved.subjectId} className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 ${isEditing ? "bg-primary/5" : ""}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {lab.subjectName}{lab.subjectCode ? <span className="text-muted-foreground"> ({lab.subjectCode})</span> : null}
                    </p>
                    {lab.batchWise === null && <Badge variant="outline" className="mt-1 text-[10px]">As scheduled</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <label className={`flex items-center gap-2 ${isEditing ? "cursor-pointer" : "opacity-70"}`}>
                      <Checkbox
                        checked={lab.batchWise === true}
                        disabled={!isEditing || saving}
                        onCheckedChange={(v) => draftMode(v === true ? true : null)}
                      />
                      Batch-wise
                    </label>
                    <label className={`flex items-center gap-2 ${isEditing ? "cursor-pointer" : "opacity-70"}`}>
                      <Checkbox
                        checked={lab.batchWise === false}
                        disabled={!isEditing || saving}
                        onCheckedChange={(v) => draftMode(v === true ? false : null)}
                      />
                      No batch
                    </label>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>Cancel</Button>
                        <Button size="sm" onClick={() => void save()} loading={saving}>Save</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => startEdit(saved)} disabled={editingId !== null}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit
                      </Button>
                    )}
                  </div>

                  {/* Faculty of this lab: their batch (batch-wise labs) and the dates they teach it
                      (when more than one faculty share the lab). */}
                  {(lab.batchWise === true || lab.faculty.length >= 2) && (
                    <div className="basis-full space-y-2 rounded-md bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">
                        {isEditing
                          ? `Click a faculty to ${lab.batchWise === true ? "tick their batch and " : ""}set the dates they teach this lab. Outside its own dates a faculty does not see the lab in their Teaching Load and cannot take its attendance; leave both dates empty for the whole term.${lab.batchWise === true ? " Two faculty may share a batch; one without a batch follows the timetable period's own batch." : ""}`
                          : "Each faculty's batch and teaching dates for this lab."}
                      </p>
                      {lab.faculty.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No faculty is assigned to this lab yet.</p>
                      ) : (
                        lab.faculty.map((f) => {
                          const key = `${lab.subjectId}::${f.facultyId}`;
                          const isOpen = isEditing && openFaculty === key;
                          return (
                            <div key={f.facultyId} className={`rounded-md border bg-background ${isOpen ? "border-primary" : ""}`}>
                              <button
                                type="button"
                                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left disabled:cursor-default"
                                disabled={!isEditing}
                                onClick={() => setOpenFaculty(isOpen ? null : key)}
                                aria-expanded={isOpen}
                              >
                                <span className="text-sm font-medium">{f.facultyName || "Faculty"}</span>
                                <span className="flex flex-wrap items-center gap-2">
                                  {f.window && f.window.from && f.window.to ? (
                                    <Badge variant="outline" className="text-[10px]">
                                      {dmy(f.window.from)} to {dmy(f.window.to)}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">{isEditing ? "Set dates" : "Whole term"}</span>
                                  )}
                                  {lab.batchWise === true && (
                                    f.batch ? (
                                      <Badge variant="approved" className="text-[10px]">{f.batch}</Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">{isEditing ? "Assign batch" : "Period's own batch"}</span>
                                    )
                                  )}
                                </span>
                              </button>
                              {isOpen && (
                                <div className="space-y-3 border-t px-3 py-2.5">
                                  {lab.batchWise === true && (
                                    batches.length === 0 ? (
                                      <p className="text-xs text-amber-700">
                                        No batch has students yet. Create a batch above, move students into it and press Update - it will then appear here to assign.
                                      </p>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                                        <span className="text-xs text-muted-foreground">Batch</span>
                                        {batches.map((b) => (
                                          <label key={b} className="flex cursor-pointer items-center gap-2 text-sm">
                                            <Checkbox
                                              checked={!!f.batch && sameBatch(f.batch, b)}
                                              onCheckedChange={(v) => draftFacultyBatch(f.facultyId, v === true ? b : null)}
                                            />
                                            {b}
                                          </label>
                                        ))}
                                      </div>
                                    )
                                  )}
                                  <div className="flex flex-wrap items-end gap-3">
                                    <div className="space-y-1">
                                      <span className="text-xs text-muted-foreground">Teaches from</span>
                                      <input
                                        type="date"
                                        className="block h-9 rounded-md border bg-background px-2 text-sm"
                                        value={f.window?.from ?? ""}
                                        max={f.window?.to || undefined}
                                        onChange={(e) => draftFacultyWindow(f.facultyId, { from: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <span className="text-xs text-muted-foreground">To</span>
                                      <input
                                        type="date"
                                        className="block h-9 rounded-md border bg-background px-2 text-sm"
                                        value={f.window?.to ?? ""}
                                        min={f.window?.from || undefined}
                                        onChange={(e) => draftFacultyWindow(f.facultyId, { to: e.target.value })}
                                      />
                                    </div>
                                    {f.window && (
                                      <Button type="button" size="sm" variant="ghost" onClick={() => draftFacultyWindow(f.facultyId, { from: "", to: "" })}>
                                        Whole term
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
