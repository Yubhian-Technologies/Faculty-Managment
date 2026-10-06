"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { compareStudentsForList } from "@/lib/students/listOrder";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ChevronsRight, ChevronsLeft, Pencil, Trash2, Check, X } from "lucide-react";
import { SectionLabBatchModes } from "@/components/students/SectionLabBatchModes";
import type { Section, StudentRecord } from "@/types";

// A section's own lab sub-groups (e.g. "Batch 1", "Batch 2" for split
// PRACTICAL periods - see StudentRecord.labBatch's own doc-comment). This is
// the Faculty Incharge's own equivalent of hod/students' per-student "Lab
// Batch" field, offered here as a two-list mover instead of one student at a
// time - deliberately NOT offered to HOD (they already have their own path).
// Only reaches students in a section this login is actually in charge of
// (Section.facultyInchargeUid) - enforced server-side on save, same as every
// other Faculty Incharge action (see students/[id]/route.ts PATCH).
export default function LabBatchesPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sectionId, setSectionId] = useState("");
  const [batch, setBatch] = useState("");
  // A batch is not a record anywhere - it is just the labBatch string on each
  // student (see StudentRecord.labBatch), so renaming one is a bulk rewrite of
  // that string and deleting one is a bulk clear. Both stage into `pending`
  // like every other move here, so they are undoable with Cancel and go out in
  // the same single save.
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [leftChecked, setLeftChecked] = useState<Set<string>>(new Set());
  const [rightChecked, setRightChecked] = useState<Set<string>>(new Set());
  // Staged, not yet saved - studentId -> the labBatch value >>/<< moved them
  // to ("" for a move back out of a batch). Committed all at once on Update,
  // discarded on Cancel - lets several moves (possibly across more than one
  // batch, via the Select above) go out as one save instead of one API call
  // per checkbox click.
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  // The batch list for the picked section while it differs from what is saved on the
  // Section doc (a rename/delete waiting for Update); null = use the saved list.
  const [localBatches, setLocalBatches] = useState<string[] | null>(null);
  // "Number of batches" field, and whether its save is running.
  const [batchCount, setBatchCount] = useState("");
  const [isSavingBatches, setIsSavingBatches] = useState(false);
  // Bumped each time the student data is reloaded, so the lab list below re-reads the batches just saved.
  const [savedVersion, setSavedVersion] = useState(0);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: Section[] }>).then((d) => d.sections ?? []),
      fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentRecord[] }>).then((d) => d.students ?? []),
    ])
      .then(([sec, stu]) => {
        setSections(sec);
        setStudents(stu);
        setPending(new Map());
        setLeftChecked(new Set());
        setRightChecked(new Set());
        setRenameTarget(null);
        setDeleteTarget(null);
        setSavedVersion((v) => v + 1);
        setLocalBatches(null);
        setSectionId((current) => (current && sec.some((s) => s.id === current) ? current : sec[0]?.id ?? ""));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load students" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Wrapped so load()'s setState calls aren't reachable synchronously from
    // the effect body (react-hooks/set-state-in-effect).
    void (async () => { load(); })();
  }, []);

  // The API already scopes both fetches to exactly this login's in-charge
  // sections - this is a defense-in-depth re-check, not the primary
  // authorization boundary, same convention as panel/students/page.tsx.
  const inChargeKeys = useMemo(() => new Set(sections.map((s) => `${s.department}::${s.name}::${s.year}`)), [sections]);
  const authorizedStudents = useMemo(
    () => students.filter((s) =>
      inChargeKeys.has(`${s.department}::${s.section}::${s.year}`)
      || inChargeKeys.has(`${s.secondaryDepartment ?? ""}::${s.section}::${s.year}`)
    ),
    [students, inChargeKeys]
  );

  const selectedSection = sections.find((s) => s.id === sectionId) ?? null;
  // The batches set up for this section (saved on the Section doc, even with no students in them yet).
  const savedBatches = localBatches ?? selectedSection?.labBatches ?? [];
  const sectionStudents = useMemo(() => {
    if (!selectedSection) return [];
    return authorizedStudents
      .filter((s) =>
        (s.department === selectedSection.department || s.secondaryDepartment === selectedSection.department)
        && s.section === selectedSection.name && s.year === selectedSection.year
      )
      .sort(compareStudentsForList);
  }, [authorizedStudents, selectedSection]);

  function effectiveBatch(s: StudentRecord & { id: string }): string {
    return (pending.get(s.id) ?? s.labBatch ?? "").trim();
  }

  // Every batch label currently in use in this section (including a
  // brand-new one just created below, before anyone's actually been moved
  // into it yet) - offered in the Select so a second student gets typed/
  // picked in as exactly the same label (labBatch match is case/whitespace-
  // insensitive, but only once it's an exact word-for-word match otherwise -
  // see lib/students/sectionRoster.ts).
  const batchOptions = useMemo(() => {
    const labels = new Set<string>(savedBatches);
    for (const s of sectionStudents) {
      const v = effectiveBatch(s);
      if (v) labels.add(v);
    }
    if (batch) labels.add(batch);
    return Array.from(labels).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionStudents, pending, batch, savedBatches]);

  // Switching section: batches are scoped per section, so the picked batch
  // and any staged-but-unsaved moves from the previous section no longer
  // apply - same as switching away without saving discards them.
  function handleSectionChange(id: string) {
    setSectionId(id);
    setBatch("");
    setPending(new Map());
    setLeftChecked(new Set());
    setRightChecked(new Set());
    setRenameTarget(null);
    setDeleteTarget(null);
    setLocalBatches(null);
    setBatchCount("");
  }

  function handleBatchChange(value: string) {
    setBatch(value);
    setLeftChecked(new Set());
    setRightChecked(new Set());
  }

  // Saves the section's batch list straight away (Section.labBatches), so a batch exists
  // before any student is moved into it. Resolves true on success.
  async function persistBatches(list: string[]): Promise<boolean> {
    if (!selectedSection) return false;
    setIsSavingBatches(true);
    try {
      const res = await fetch("/api/college/section-lab-batches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId: selectedSection.id, labBatches: list }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; labBatches?: string[] };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not save the batches", description: json.error });
        return false;
      }
      const saved = json.labBatches ?? list;
      // Keep the section list current so Cancel falls back to what is really saved.
      setSections((prev) => prev.map((x) => (x.id === selectedSection.id ? { ...x, labBatches: saved } : x)));
      setLocalBatches(null);
      // The lab list below reads the saved batches, so let it pick up the new ones.
      setSavedVersion((v) => v + 1);
      return true;
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
      return false;
    } finally {
      setIsSavingBatches(false);
    }
  }

  // Step 2: "this section has N batches" - names them Batch 1..N (keeping any already
  // there) and saves. Students are divided into them afterwards.
  async function handleSaveBatchCount() {
    const n = Math.floor(Number(batchCount));
    if (!selectedSection || !Number.isFinite(n) || n < 1 || n > 20) {
      toast({ variant: "destructive", title: "Enter a number of batches between 1 and 20" });
      return;
    }
    const existing = batchOptions;
    if (n < existing.length) {
      toast({ variant: "destructive", title: `This section already has ${existing.length} batches`, description: "Delete a batch with the bin icon to have fewer." });
      return;
    }
    const taken = new Set(existing.map((b) => b.toLowerCase()));
    const list = [...existing];
    for (let i = 1; list.length < n; i++) {
      const label = `Batch ${i}`;
      if (!taken.has(label.toLowerCase())) { list.push(label); taken.add(label.toLowerCase()); }
    }
    if (n === existing.length) {
      // Same count: nothing new to name, but make sure the list is saved.
      if (await persistBatches(list)) toast({ variant: "success", title: `${n} batch${n === 1 ? "" : "es"} saved` });
      return;
    }
    if (await persistBatches(list)) {
      toast({ variant: "success", title: `${n} batch${n === 1 ? "" : "es"} saved`, description: "Now divide the students into them below." });
      setBatchCount("");
    }
  }

  function startRename(b: string) {
    setRenameTarget(b);
    setRenameValue(b);
  }

  function handleRenameBatch() {
    const from = renameTarget;
    const to = renameValue.trim();
    if (!from || !to) return;
    if (to === from) { setRenameTarget(null); return; }
    // labBatch is matched case/whitespace-insensitively downstream (see
    // lib/students/sectionRoster.ts), so two batches differing only in case
    // would silently behave as one. Renaming ONTO another batch is a merge,
    // which is not what the pencil suggests - refuse it and say so.
    if (batchOptions.some((b) => b !== from && b.toLowerCase() === to.toLowerCase())) {
      toast({ variant: "destructive", title: `"${to}" already exists`, description: "Pick a different name, or move the students across instead." });
      return;
    }
    setPending((prev) => {
      const next = new Map(prev);
      for (const s of sectionStudents) {
        if ((prev.get(s.id) ?? s.labBatch ?? "").trim() === from) next.set(s.id, to);
      }
      return next;
    });
    // The saved list follows on Update, together with the students' labels.
    setLocalBatches(savedBatches.map((b) => (b === from ? to : b)));
    if (batch === from) setBatch(to);
    setRenameTarget(null);
  }

  // Deleting a batch never removes a student - it only takes them out of the
  // batch, back into the unassigned pool on the left.
  function handleDeleteBatch() {
    const target = deleteTarget;
    if (!target) return;
    setPending((prev) => {
      const next = new Map(prev);
      for (const s of sectionStudents) {
        if ((prev.get(s.id) ?? s.labBatch ?? "").trim() === target) next.set(s.id, "");
      }
      return next;
    });
    setLocalBatches(savedBatches.filter((b) => b !== target));
    if (batch === target) setBatch("");
    setDeleteTarget(null);
    setLeftChecked(new Set());
    setRightChecked(new Set());
  }

  // Before any batch is picked ("Select batch" still showing), the left list
  // is just everyone in the section - there's no batch to exclude yet.
  // Filtering by `effectiveBatch(s) !== batch` even then would wrongly drop
  // every still-unassigned student too, since their own effective batch is
  // also "" - the same empty string `batch` itself is.
  const leftList = batch ? sectionStudents.filter((s) => effectiveBatch(s) !== batch) : sectionStudents;
  const unassignedCount = sectionStudents.filter((s) => effectiveBatch(s) === "").length;
  const rightList = batch ? sectionStudents.filter((s) => effectiveBatch(s) === batch) : [];

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string, checked: boolean) {
    const next = new Set(set);
    if (checked) next.add(id); else next.delete(id);
    setSet(next);
  }

  function moveRight() {
    if (!batch || leftChecked.size === 0) return;
    setPending((prev) => {
      const next = new Map(prev);
      for (const id of leftChecked) next.set(id, batch);
      return next;
    });
    setLeftChecked(new Set());
  }

  function moveLeft() {
    if (rightChecked.size === 0) return;
    setPending((prev) => {
      const next = new Map(prev);
      for (const id of rightChecked) next.set(id, "");
      return next;
    });
    setRightChecked(new Set());
  }

  function handleCancel() {
    setLocalBatches(null);
    setPending(new Map());
    setLeftChecked(new Set());
    setRightChecked(new Set());
  }

  async function handleUpdate() {
    if (pending.size === 0 && localBatches === null) {
      toast({ title: "No changes to save" });
      return;
    }
    setIsSaving(true);
    try {
      const entries = Array.from(pending.entries());
      const results = await Promise.all(
        entries.map(([id, labBatch]) =>
          fetch(`/api/college/students/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ labBatch }),
          }).then((r) => r.ok)
        )
      );
      const failed = results.filter((ok) => !ok).length;
      // The batch list (a rename/delete) is saved after the students, so a batch is never
      // dropped while a student is still in it.
      if (failed === 0 && localBatches !== null) await persistBatches(localBatches);
      if (failed > 0) {
        toast({ variant: "destructive", title: `${failed} of ${entries.length} update(s) failed`, description: "Try again for the ones that didn't go through." });
      } else {
        toast({ variant: "success", title: `Updated ${entries.length} student${entries.length !== 1 ? "s" : ""}` });
      }
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Lab Batches" description="Split your section's roster into lab sub-groups (Batch 1, Batch 2, ...)" />

      {!isLoading && sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You are not currently in charge of any section. Ask your HOD to assign you as the faculty-in-charge for a section.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3 space-y-3">
            <CardTitle className="text-base">Divide into batches</CardTitle>
            {/* Step 1 - whose roster are we splitting. */}
            <div className="grid gap-3 sm:grid-cols-2 sm:max-w-2xl">
              <div className="space-y-2">
                <Label>1. Section</Label>
                <Select value={sectionId} onValueChange={handleSectionChange}>
                  <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Batches are added with "Number of batches" below. Here the batch picked
                  below can be renamed or deleted; the name box only shows while renaming. */}
              <div className="space-y-2">
                <Label htmlFor="rename-batch-name">{renameTarget ? `Rename ${renameTarget}` : "Rename or delete a batch"}</Label>
                <div className="flex flex-wrap gap-2">
                  {renameTarget ? (
                    <>
                      <Input
                        id="rename-batch-name"
                        className="flex-1 min-w-0"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); handleRenameBatch(); }
                          if (e.key === "Escape") { e.preventDefault(); setRenameTarget(null); }
                        }}
                        placeholder="New name"
                      />
                      <Button type="button" className="shrink-0" onClick={handleRenameBatch} disabled={!renameValue.trim()}>
                        <Check className="h-4 w-4 mr-1.5" />Save name
                      </Button>
                      <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => setRenameTarget(null)} title="Cancel rename" aria-label="Cancel rename">
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button" variant="outline" className="shrink-0"
                        onClick={() => { if (batch) startRename(batch); }}
                        disabled={!batch}
                        title={batch ? `Rename ${batch}` : "Pick a batch below first"}
                      >
                        <Pencil className="h-4 w-4 mr-1.5" />Rename
                      </Button>
                      <Button
                        type="button" variant="outline"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => { if (batch) setDeleteTarget(batch); }}
                        disabled={!batch}
                        title={batch ? `Delete ${batch}` : "Pick a batch below first"}
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" />Delete
                      </Button>
                      {!batch && <span className="self-center text-xs text-muted-foreground">Pick a batch below first</span>}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Set up the batches FIRST: how many, then Save - only after that are students divided
                into them (below). Saved on the section, so the batches exist even with no students in them. */}
            <div className="space-y-2 sm:max-w-2xl">
              <Label htmlFor="batch-count">Number of batches (set this first)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="batch-count"
                  type="number"
                  min={1}
                  max={20}
                  className="w-28"
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSaveBatchCount(); } }}
                  placeholder="e.g. 2"
                  disabled={!selectedSection}
                />
                <Button type="button" onClick={() => void handleSaveBatchCount()} loading={isSavingBatches} disabled={!selectedSection || !batchCount.trim()}>
                  Save batches
                </Button>
                <span className="text-xs text-muted-foreground">
                  {savedBatches.length > 0
                    ? `Saved: ${savedBatches.join(", ")}. Now divide the students into them below.`
                    : "Enter how many batches this section has and save, then divide the students below."}
                </span>
              </div>
            </div>

            {/* Step 3 - which batch the mover below fills. Chips rather than a
                dropdown: a section has two or three batches, and their sizes
                are the whole point of the screen, so showing them all with
                their counts beats hiding them behind a closed Select. */}
            {selectedSection && batchOptions.length > 0 && (
              <div className="space-y-2">
                <Label>3. Batch to fill</Label>
                <div className="flex flex-wrap gap-2">
                  {batchOptions.map((b) => {
                    const active = b === batch;
                    return (
                      <button
                        key={b}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleBatchChange(b)}
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {b}
                      </button>
                    );
                  })}
                  <span className="inline-flex items-center px-1 text-xs text-muted-foreground">
                    {unassignedCount} not in any batch
                  </span>
                </div>
              </div>
            )}

            {selectedSection && batchOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                This section has no batches yet - the first one you add gets everyone. Add a second batch, then move specific students into it below.
              </p>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-64 bg-muted animate-pulse rounded-lg" />
            ) : !selectedSection ? (
              <p className="text-sm text-muted-foreground text-center py-8">Select a section to get started.</p>
            ) : (
              <>
                {/* Step 4 - names the batch being filled, so the two lists are
                    never ambiguous about which batch "in" and "not in" mean. */}
                <p className="mb-3 text-sm font-medium">
                  {batch
                    ? <>4. Move students into <span className="text-primary">{batch}</span></>
                    : batchOptions.length === 0
                      ? "4. Move students - add a batch above first"
                      : "4. Move students - pick a batch above first"}
                </p>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] items-stretch">
                  <StudentListBox
                    title={batch ? "Not in this batch" : "Students"}
                    students={leftList}
                    checked={leftChecked}
                    onToggle={(id, checked) => toggle(leftChecked, setLeftChecked, id, checked)}
                    effectiveBatch={effectiveBatch}
                    showBatchTag
                  />

                  <div className="flex sm:flex-col items-center justify-center gap-2">
                    <Button type="button" variant="outline" size="icon" onClick={moveRight} disabled={!batch || leftChecked.size === 0} title="Add checked students to the batch">
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" onClick={moveLeft} disabled={rightChecked.size === 0} title="Remove checked students from the batch">
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                  </div>

                  <StudentListBox
                    title={batch ? `In ${batch} (${rightList.length})` : "No batch picked"}
                    students={rightList}
                    checked={rightChecked}
                    onToggle={(id, checked) => toggle(rightChecked, setRightChecked, id, checked)}
                    effectiveBatch={effectiveBatch}
                    emptyLabel={batch
                      ? "No students in this batch yet - tick some on the left, then use the → button."
                      : "Pick a batch above to start moving students into it."}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
                  {(pending.size > 0 || localBatches !== null) && (
                    <p className="mr-auto self-center text-xs text-muted-foreground">
                      {pending.size > 0 ? `${pending.size} unsaved student change${pending.size !== 1 ? "s" : ""}` : "Unsaved batch changes"}
                    </p>
                  )}
                  <Button type="button" variant="outline" onClick={handleCancel} disabled={(pending.size === 0 && localBatches === null) || isSaving}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleUpdate} loading={isSaving} disabled={pending.size === 0 && localBatches === null}>
                    Update
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {sectionId && sections.length > 0 && <SectionLabBatchModes key={`${sectionId}-${savedVersion}`} sectionId={sectionId} />}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget ?? ""}?`}
        description={
          deleteTarget
            ? `${sectionStudents.filter((s) => effectiveBatch(s) === deleteTarget).length} student(s) go back to being unassigned. No student is removed from the section. Nothing is saved until you press Update.`
            : undefined
        }
        confirmLabel="Delete batch"
        variant="destructive"
        onConfirm={handleDeleteBatch}
      />
    </div>
  );
}

function StudentListBox({
  title, students, checked, onToggle, effectiveBatch, showBatchTag, emptyLabel,
}: {
  title: string;
  students: (StudentRecord & { id: string })[];
  checked: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  effectiveBatch: (s: StudentRecord & { id: string }) => string;
  showBatchTag?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="rounded-lg border h-80 overflow-y-auto divide-y">
        {students.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8 px-3">{emptyLabel ?? "No students here."}</p>
        ) : (
          students.map((s) => {
            const currentBatch = showBatchTag ? effectiveBatch(s) : "";
            return (
              <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer">
                <Checkbox checked={checked.has(s.id)} onCheckedChange={(v) => onToggle(s.id, v === true)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.rollNumber || "—"}</span>{" "}
                  <span className="text-muted-foreground">{s.name}</span>
                </span>
                {currentBatch && <Badge variant="outline" className="text-[10px] shrink-0">{currentBatch}</Badge>}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
