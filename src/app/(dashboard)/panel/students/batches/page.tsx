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
import { ArrowRight, Pencil, Trash2, Check, X } from "lucide-react";
import { SectionLabBatchModes } from "@/components/students/SectionLabBatchModes";
import type { Section, StudentRecord } from "@/types";

type Student = StudentRecord & { id: string };

// "Unassigned" in the Move-to picker (a Select value can't be an empty string).
const UNASSIGNED = "__unassigned__";

// A section's own lab sub-groups (e.g. "Batch 1", "Batch 2" for split PRACTICAL periods - see
// StudentRecord.labBatch). The Faculty Incharge sets how many batches there are, then moves students
// between them on a board: one column per batch plus "Unassigned". Moves are staged and saved together
// with Update; deleting a batch takes effect straight away (its students become unassigned).
// Only reaches sections this login is in charge of - enforced server-side on every write.
export default function LabBatchesPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [query, setQuery] = useState("");
  // Ticked students (across all columns) and where the Move button sends them.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  // Staged, not yet saved: studentId -> the labBatch it will get ("" = no batch).
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  // The batch list while a rename is waiting for Update; null = use the saved list.
  const [localBatches, setLocalBatches] = useState<string[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [batchCount, setBatchCount] = useState("");
  const [isSavingBatches, setIsSavingBatches] = useState(false);
  // Bumped on each reload so the lab list below re-reads the batches just saved.
  const [savedVersion, setSavedVersion] = useState(0);

  // Only the picked section's students are read - never the whole in-charge roster.
  async function loadStudentsOf(sec: Section | null) {
    if (!sec) { setStudents([]); return; }
    setIsLoadingStudents(true);
    try {
      const qs = new URLSearchParams({ section: sec.name, year: String(sec.year) });
      const res = await fetch(`/api/college/students?${qs}`);
      const d = (await res.json()) as { students?: StudentRecord[]; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setStudents(d.students ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsLoadingStudents(false);
    }
  }

  function resetEdits() {
    setPending(new Map());
    setSelected(new Set());
    setMoveTo("");
    setRenameTarget(null);
    setDeleteTarget(null);
    setLocalBatches(null);
  }

  function load() {
    setIsLoading(true);
    fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: Section[] }>).then((d) => d.sections ?? [])
      .then((sec) => {
        setSections(sec);
        resetEdits();
        setSavedVersion((v) => v + 1);
        const keep = sec.find((s) => s.id === sectionId) ?? sec[0] ?? null;
        setSectionId(keep?.id ?? "");
        return loadStudentsOf(keep);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load students" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Wrapped so load()'s setState calls aren't reachable synchronously from
    // the effect body (react-hooks/set-state-in-effect).
    void (async () => { load(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSection = sections.find((s) => s.id === sectionId) ?? null;
  const savedBatches = localBatches ?? selectedSection?.labBatches ?? [];

  // Defense-in-depth re-check; the API already scopes the fetch to this login's in-charge sections.
  const sectionStudents = useMemo(() => {
    if (!selectedSection) return [] as Student[];
    return (students as Student[])
      .filter((s) =>
        (s.department === selectedSection.department || s.secondaryDepartment === selectedSection.department)
        && s.section === selectedSection.name && s.year === selectedSection.year
      )
      .sort(compareStudentsForList);
  }, [students, selectedSection]);

  const effectiveBatch = (s: Student) => (pending.get(s.id) ?? s.labBatch ?? "").trim();

  // Every batch in use: the saved list (even empty batches) plus whatever students carry, one entry per
  // name whatever its case (the roster match ignores case), numerically ordered ("Batch 2" before "Batch 10").
  const batchOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const b of [...savedBatches, ...sectionStudents.map(effectiveBatch)]) {
      const label = b.trim();
      if (label && !byKey.has(label.toLowerCase())) byKey.set(label.toLowerCase(), label);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionStudents, pending, savedBatches]);

  const needle = query.trim().toLowerCase();
  const visible = (s: Student) => !needle || s.name.toLowerCase().includes(needle) || (s.rollNumber ?? "").toLowerCase().includes(needle);
  const columnOf = (batch: string) => sectionStudents.filter((s) => effectiveBatch(s).toLowerCase() === batch.toLowerCase());

  const hasUnsaved = pending.size > 0 || localBatches !== null;

  function handleSectionChange(id: string) {
    setSectionId(id);
    resetEdits();
    setBatchCount("");
    setQuery("");
    void loadStudentsOf(sections.find((x) => x.id === id) ?? null);
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  // Ticks or clears every student currently shown in a column.
  function toggleColumn(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
      return next;
    });
  }

  function handleMove() {
    if (!moveTo || selected.size === 0) return;
    const label = moveTo === UNASSIGNED ? "" : moveTo;
    const byId = new Map(sectionStudents.map((s) => [s.id, s]));
    setPending((prev) => {
      const next = new Map(prev);
      for (const id of selected) {
        // Back to what is already saved = no change to save.
        if ((byId.get(id)?.labBatch ?? "").trim() === label) next.delete(id); else next.set(id, label);
      }
      return next;
    });
    setSelected(new Set());
  }

  // Saves the section's batch list straight away (Section.labBatches), so a batch exists before anyone is in it.
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
      setSections((prev) => prev.map((x) => (x.id === selectedSection.id ? { ...x, labBatches: saved } : x)));
      setLocalBatches(null);
      setSavedVersion((v) => v + 1);
      return true;
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
      return false;
    } finally {
      setIsSavingBatches(false);
    }
  }

  // "This section has N batches": names them Batch 1..N (keeping any already there) and saves.
  async function handleSaveBatchCount() {
    const n = Math.floor(Number(batchCount));
    if (!selectedSection || !Number.isFinite(n) || n < 1 || n > 20) {
      toast({ variant: "destructive", title: "Enter a number of batches between 1 and 20" });
      return;
    }
    const existing = batchOptions;
    if (n < existing.length) {
      toast({ variant: "destructive", title: `This section already has ${existing.length} batches`, description: "Delete a batch with its bin icon to have fewer." });
      return;
    }
    const taken = new Set(existing.map((b) => b.toLowerCase()));
    const list = [...existing];
    for (let i = 1; list.length < n; i++) {
      const label = `Batch ${i}`;
      if (!taken.has(label.toLowerCase())) { list.push(label); taken.add(label.toLowerCase()); }
    }
    if (await persistBatches(list)) {
      toast({ variant: "success", title: `${n} batch${n === 1 ? "" : "es"} saved`, description: n === existing.length ? undefined : "Now divide the students into them below." });
      setBatchCount("");
    }
  }

  function handleRenameBatch() {
    const from = renameTarget;
    const to = renameValue.trim();
    if (!from || !to) return;
    if (to === from) { setRenameTarget(null); return; }
    // Roster matching ignores case, so two names differing only in case would act as one; renaming ONTO
    // another batch would be a merge, which the pencil doesn't suggest - refuse it.
    if (batchOptions.some((b) => b !== from && b.toLowerCase() === to.toLowerCase())) {
      toast({ variant: "destructive", title: `"${to}" already exists`, description: "Pick a different name, or move the students across instead." });
      return;
    }
    setPending((prev) => {
      const next = new Map(prev);
      for (const s of sectionStudents) {
        if (effectiveBatch(s).toLowerCase() === from.toLowerCase()) next.set(s.id, to);
      }
      return next;
    });
    setLocalBatches(savedBatches.map((b) => (b.toLowerCase() === from.toLowerCase() ? to : b)));
    setRenameTarget(null);
  }

  // Straight away, students included: they become unassigned. (Needs no unsaved edits, so the board
  // can simply reload from what was saved.)
  async function handleDeleteBatch() {
    const target = deleteTarget;
    if (!target || !selectedSection) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/college/section-lab-batches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId: selectedSection.id, deleteBatch: target }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; unassigned?: number; slotsStillUsingBatch?: number };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not delete the batch", description: json.error });
        return;
      }
      const slots = json.slotsStillUsingBatch ?? 0;
      toast({
        variant: "success",
        title: `${target} deleted`,
        description: [
          `${json.unassigned ?? 0} student${json.unassigned === 1 ? " is" : "s are"} now unassigned.`,
          slots > 0 ? `${slots} timetable period${slots === 1 ? "" : "s"} still use this batch name - update them in the timetable.` : "",
        ].filter(Boolean).join(" "),
      });
      setDeleteTarget(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleUpdate() {
    if (!hasUnsaved || !selectedSection) {
      toast({ title: "No changes to save" });
      return;
    }
    setIsSaving(true);
    try {
      // All the moves go out as one request (one write for the section), not one per student.
      if (pending.size > 0) {
        const res = await fetch("/api/college/section-lab-batches", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectionId: selectedSection.id, assign: Object.fromEntries(pending) }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; updated?: number };
        if (!res.ok) {
          toast({ variant: "destructive", title: "Could not save the changes", description: json.error });
          return;
        }
        toast({ variant: "success", title: `Updated ${json.updated ?? pending.size} student${(json.updated ?? pending.size) === 1 ? "" : "s"}` });
      }
      // The list (after a rename) is saved after the students, so a batch is never dropped while someone is in it.
      if (localBatches !== null && !(await persistBatches(localBatches))) return;
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsSaving(false);
    }
  }

  const columns = [{ key: "", title: "Unassigned" }, ...batchOptions.map((b) => ({ key: b, title: b }))];
  const deleteCount = deleteTarget ? columnOf(deleteTarget).length : 0;

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
        <>
          <Card>
            <CardHeader className="pb-3 space-y-3">
              <CardTitle className="text-base">Set up the batches</CardTitle>
              <div className="grid gap-4 sm:grid-cols-2 sm:max-w-2xl">
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
                <div className="space-y-2">
                  <Label htmlFor="batch-count">2. Number of batches</Label>
                  <div className="flex gap-2">
                    <Input
                      id="batch-count" type="number" min={1} max={20} className="w-24"
                      value={batchCount}
                      onChange={(e) => setBatchCount(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSaveBatchCount(); } }}
                      placeholder="e.g. 2"
                      disabled={!selectedSection}
                    />
                    <Button type="button" onClick={() => void handleSaveBatchCount()} loading={isSavingBatches} disabled={!selectedSection || !batchCount.trim()}>
                      Save batches
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {savedBatches.length > 0
                  ? `Saved: ${savedBatches.join(", ")}.`
                  : "Enter how many batches this section has and save; then move the students into them below."}
              </p>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">3. Divide the students</CardTitle>
                <Input
                  className="w-full sm:w-64" placeholder="Search roll no. or name" value={query}
                  onChange={(e) => setQuery(e.target.value)} disabled={!selectedSection}
                />
              </div>
              {/* Appears once someone is ticked: pick where they go, in any batch or back to Unassigned. */}
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2">
                  <span className="text-sm font-medium">{selected.size} selected</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Select value={moveTo} onValueChange={setMoveTo}>
                    <SelectTrigger className="w-44 bg-background"><SelectValue placeholder="Move to…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {batchOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" onClick={handleMove} disabled={!moveTo}>Move</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {isLoading || isLoadingStudents ? (
                <div className="h-64 bg-muted animate-pulse rounded-lg" />
              ) : !selectedSection ? (
                <p className="text-sm text-muted-foreground text-center py-8">Select a section to get started.</p>
              ) : (
                <>
                  {batchOptions.length === 0 && (
                    <p className="mb-3 text-xs text-muted-foreground">No batches yet - set the number of batches above and save.</p>
                  )}
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {columns.map((col) => {
                      const all = columnOf(col.key);
                      const shown = all.filter(visible);
                      const ids = shown.map((s) => s.id);
                      const ticked = ids.filter((id) => selected.has(id)).length;
                      const isBatch = col.key !== "";
                      const renaming = isBatch && renameTarget === col.key;
                      return (
                        <div key={col.key || UNASSIGNED} className="rounded-lg border flex flex-col">
                          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                            <Checkbox
                              aria-label={`Select all in ${col.title}`}
                              disabled={ids.length === 0}
                              checked={ids.length > 0 && ticked === ids.length ? true : ticked > 0 ? "indeterminate" : false}
                              className="data-[state=indeterminate]:bg-primary/20"
                              onCheckedChange={(v) => toggleColumn(ids, v === true)}
                            />
                            {renaming ? (
                              <>
                                <Input
                                  autoFocus className="h-7 min-w-0 flex-1" value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); handleRenameBatch(); }
                                    if (e.key === "Escape") { e.preventDefault(); setRenameTarget(null); }
                                  }}
                                />
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleRenameBatch} disabled={!renameValue.trim()} aria-label="Save name"><Check className="h-4 w-4" /></Button>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRenameTarget(null)} aria-label="Cancel rename"><X className="h-4 w-4" /></Button>
                              </>
                            ) : (
                              <>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{col.title}</span>
                                <Badge variant="secondary" className="text-[10px]">{all.length}</Badge>
                                {isBatch && (
                                  <>
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={`Rename ${col.title}`} aria-label={`Rename ${col.title}`}
                                      onClick={() => { setRenameTarget(col.key); setRenameValue(col.key); }}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                      title={hasUnsaved ? "Update or Cancel your unsaved changes first" : `Delete ${col.title}`} aria-label={`Delete ${col.title}`}
                                      disabled={hasUnsaved}
                                      onClick={() => setDeleteTarget(col.key)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                          <div className="h-72 overflow-y-auto divide-y">
                            {shown.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-8 px-3">
                                {all.length === 0
                                  ? isBatch ? "Empty - tick students elsewhere and move them here." : "Everyone is in a batch."
                                  : "No match for the search."}
                              </p>
                            ) : (
                              shown.map((s) => (
                                <label key={s.id} className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 ${selected.has(s.id) ? "bg-primary/5" : ""}`}>
                                  <Checkbox checked={selected.has(s.id)} onCheckedChange={(v) => toggleOne(s.id, v === true)} />
                                  <span className="min-w-0 flex-1 truncate">
                                    <span className="font-medium">{s.rollNumber || "—"}</span>{" "}
                                    <span className="text-muted-foreground">{s.name}</span>
                                  </span>
                                  {pending.has(s.id) && <Badge variant="outline" className="text-[10px] shrink-0">moved</Badge>}
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
                    {hasUnsaved && (
                      <p className="mr-auto self-center text-xs text-muted-foreground">
                        {pending.size > 0 ? `${pending.size} unsaved student change${pending.size !== 1 ? "s" : ""}` : "Unsaved batch changes"}
                      </p>
                    )}
                    <Button type="button" variant="outline" onClick={resetEdits} disabled={!hasUnsaved || isSaving}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleUpdate} loading={isSaving} disabled={!hasUnsaved}>
                      Update
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {sectionId && sections.length > 0 && <SectionLabBatchModes key={`${sectionId}-${savedVersion}`} sectionId={sectionId} />}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget ?? ""}?`}
        description={`The batch is removed straight away. ${deleteCount} student${deleteCount === 1 ? "" : "s"} in it become${deleteCount === 1 ? "s" : ""} unassigned; no student leaves the section.`}
        confirmLabel="Delete batch"
        loading={isDeleting}
        variant="destructive"
        onConfirm={() => void handleDeleteBatch()}
      />
    </div>
  );
}
