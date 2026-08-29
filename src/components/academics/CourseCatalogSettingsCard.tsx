"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Plus, Pencil, Trash2, Check, X, GraduationCap, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import { currentAcademicStartYear, deriveBatch } from "@/lib/college/academicSession";
import type { CourseCatalogItem } from "@/types";

type Draft = { name: string; code: string; durationYears: string; regulations: string[]; regulationBatches: Record<string, string> };
const EMPTY_DRAFT: Draft = { name: "", code: "", durationYears: "4", regulations: [], regulationBatches: {} };

/**
 * "2023-2027,2024-2028,2025-2029" - every consecutive intake starting
 * `startYear` for `numBatches` admission years, each spanning the course's
 * own duration (deriveBatch).
 */
function computeRegulationBatches(startYear: number, numBatches: number, courseDurationYears: number): string {
  const years = Array.from({ length: numBatches }, (_, i) => startYear + i);
  return years.map((y) => deriveBatch(y, courseDurationYears)).join(",");
}

/**
 * Add/remove regulations for a course draft (used identically for the "Add
 * new course" panel and each item's Edit mode) - a regulation is created
 * right here, by giving it an intake starting year (e.g. 2023) and how many
 * consecutive intakes follow it (e.g. 3 -> 2023, 2024, 2025 all fall under
 * this regulation, until a newer one supersedes it), rather than declared
 * standalone elsewhere and attached afterward. Typing a code already used by
 * another course reuses it (`knownCodes` just offers it back via the
 * datalist); there is no separate registry to keep it in sync with.
 */
function RegulationBatchesEditor({
  draft, setDraft, courseDurationYears, knownCodes, listId,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  courseDurationYears: number;
  knownCodes: string[];
  listId: string;
}) {
  const [code, setCode] = useState("");
  const [startYear, setStartYear] = useState(String(currentAcademicStartYear()));
  const [numBatches, setNumBatches] = useState("1");

  function addRegulation() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { toast({ variant: "destructive", title: "Enter a regulation code" }); return; }
    const start = Number(startYear);
    const count = Number(numBatches);
    if (!start || String(start).length !== 4) {
      toast({ variant: "destructive", title: "Starting year must be a 4-digit year, e.g. 2023" });
      return;
    }
    if (!count || count < 1) {
      toast({ variant: "destructive", title: "Number of batches must be at least 1" });
      return;
    }
    const batches = computeRegulationBatches(start, count, courseDurationYears);
    setDraft({
      ...draft,
      regulations: draft.regulations.includes(trimmed) ? draft.regulations : [...draft.regulations, trimmed],
      regulationBatches: { ...draft.regulationBatches, [trimmed]: batches },
    });
    setCode("");
    setStartYear(String(currentAcademicStartYear()));
    setNumBatches("1");
  }

  function removeRegulation(regCode: string) {
    const regulationBatches = { ...draft.regulationBatches };
    delete regulationBatches[regCode];
    setDraft({ ...draft, regulations: draft.regulations.filter((r) => r !== regCode), regulationBatches });
  }

  return (
    <div className="space-y-2">
      {draft.regulations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.regulations.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
              {r}{draft.regulationBatches[r] ? ` — ${draft.regulationBatches[r]}` : ""}
              <button type="button" onClick={() => removeRegulation(r)} className="rounded-full hover:bg-muted-foreground/20" title={`Remove ${r}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. R23" className="w-24 uppercase" list={listId} />
          <datalist id={listId}>
            {knownCodes.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Starting Year</Label>
          <Input value={startYear} onChange={(e) => setStartYear(stripLeadingZeros(e.target.value))} placeholder="2023" className="w-24" maxLength={4} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">No. of Batches</Label>
          <Input type="number" min={1} value={numBatches} onChange={(e) => setNumBatches(stripLeadingZeros(e.target.value))} className="w-24" />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addRegulation}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        E.g. Starting Year 2023, 3 batches - the 2023, 2024 and 2025 intakes all follow this regulation.
      </p>
    </div>
  );
}

interface CourseCatalogSettingsCardProps {
  // Dean's dashboard reads the same catalog off the Principal's own GET
  // endpoint, but can't POST/PATCH/DELETE it - so this hides the add form
  // and per-item edit/delete/activate controls and shows courses + their
  // assigned regulations only.
  readOnly?: boolean;
}

export function CourseCatalogSettingsCard({ readOnly = false }: CourseCatalogSettingsCardProps) {
  const [items, setItems] = useState<CourseCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Every regulation code any course already uses - purely a reuse/autocomplete
  // suggestion for RegulationBatchesEditor's Code field (see its own doc-comment),
  // not a separate registry: typing a new code there is the only way one gets
  // created at all.
  const knownRegulationCodes = useMemo(
    () => Array.from(new Set(items.flatMap((i) => i.regulations ?? []))).sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isAdding, setIsAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<CourseCatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function load() {
    return fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => setItems(d.items ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load course catalog" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function validate(d: Draft): string | null {
    if (!d.name.trim()) return "Course name is required";
    if (!d.code.trim()) return "Short code is required";
    const yr = Number(d.durationYears);
    if (!yr || yr < 1 || yr > 10) return "Duration must be between 1 and 10 years";
    return null;
  }

  async function addItem() {
    const err = validate(newDraft);
    if (err) { toast({ variant: "destructive", title: err }); return; }
    setIsAdding(true);
    try {
      const res = await fetch("/api/college/course-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDraft.name.trim(),
          code: newDraft.code.trim(),
          durationYears: Number(newDraft.durationYears),
          regulations: newDraft.regulations,
          regulationBatches: newDraft.regulationBatches,
        }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to add course");
      }
      setNewDraft(EMPTY_DRAFT);
      toast({ variant: "success", title: "Course added to catalog" });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to add course" });
    } finally {
      setIsAdding(false);
    }
  }

  function startEdit(item: CourseCatalogItem) {
    setEditingId(item.id);
    setEditDraft({
      name: item.name,
      code: item.code,
      durationYears: String(item.durationYears),
      regulations: item.regulations ?? [],
      regulationBatches: item.regulationBatches ?? {},
    });
  }

  async function saveEdit(id: string) {
    const err = validate(editDraft);
    if (err) { toast({ variant: "destructive", title: err }); return; }
    setBusyId(id);
    try {
      const res = await fetch(`/api/college/course-catalog/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDraft.name.trim(),
          code: editDraft.code.trim(),
          durationYears: Number(editDraft.durationYears),
          regulations: editDraft.regulations,
          regulationBatches: editDraft.regulationBatches,
        }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to update course");
      }
      setEditingId(null);
      toast({ variant: "success", title: "Course updated" });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to update course" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(item: CourseCatalogItem) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/college/course-catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/course-catalog/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to delete course");
      }
      toast({ variant: "success", title: "Course removed from catalog" });
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to delete course" });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GraduationCap className="h-4 w-4" /> Course Catalog
        </CardTitle>
        <CardDescription>
          The fixed list of courses for your entire college. Departments can only select from these — this keeps
          course names and codes consistent and prevents duplicates. Each course&apos;s curriculum regulations (e.g. R23)
          are created right here too - give one a starting year and a duration and it covers those years automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Add new - course details, then its regulations. */}
        {!readOnly && (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">1. Course details</Label>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px_120px_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Course Name</Label>
                  <Input
                    value={newDraft.name}
                    onChange={(e) => setNewDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Bachelor of Technology"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Short Code</Label>
                  <Input
                    value={newDraft.code}
                    onChange={(e) => setNewDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                    placeholder="BTECH"
                    className="uppercase"
                    maxLength={10}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Duration (years)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={newDraft.durationYears}
                    onChange={(e) => setNewDraft((d) => ({ ...d, durationYears: stripLeadingZeros(e.target.value) }))}
                  />
                </div>
                <Button onClick={addItem} loading={isAdding} className="sm:mb-0.5">
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">2. Regulations (optional - can add after too)</Label>
              <RegulationBatchesEditor
                draft={newDraft}
                setDraft={setNewDraft}
                courseDurationYears={Number(newDraft.durationYears) || 10}
                knownCodes={knownRegulationCodes}
                listId="new-course-regulations"
              />
            </div>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No courses yet. Add your college&apos;s courses above so departments can select them.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const isEditing = !readOnly && editingId === item.id;
              const busy = busyId === item.id;
              return (
                <li key={item.id} className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    {isEditing ? (
                      <>
                        <Input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          className="flex-1 min-w-40"
                        />
                        <Input
                          value={editDraft.code}
                          onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                          className="w-28 uppercase"
                          maxLength={10}
                        />
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={editDraft.durationYears}
                          onChange={(e) => setEditDraft((d) => ({ ...d, durationYears: stripLeadingZeros(e.target.value) }))}
                          className="w-20"
                        />
                        <div className="flex gap-1 ml-auto">
                          <Button size="icon" variant="ghost" onClick={() => saveEdit(item.id)} loading={busy} aria-label="Save">
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} disabled={busy} aria-label="Cancel">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-40">
                          <p className="text-sm font-medium">
                            {item.name}
                            {!item.isActive && <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.code} · {item.durationYears} {item.durationYears === 1 ? "year" : "years"}
                          </p>
                        </div>
                        {!readOnly && (
                          <div className="flex gap-1 ml-auto">
                            <Button size="sm" variant="ghost" onClick={() => toggleActive(item)} disabled={busy}>
                              {item.isActive ? "Deactivate" : "Activate"}
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => startEdit(item)} aria-label="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(item)} aria-label="Delete">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Regulations for this course</Label>
                      <RegulationBatchesEditor
                        draft={editDraft}
                        setDraft={setEditDraft}
                        courseDurationYears={Number(editDraft.durationYears) || item.durationYears || 10}
                        knownCodes={knownRegulationCodes}
                        listId={`edit-course-regulations-${item.id}`}
                      />
                    </div>
                  ) : (item.regulations ?? []).length === 0 ? (
                    <p className="flex items-center gap-1 text-xs text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> No regulations assigned yet - subjects can&apos;t be added to this course until you add at least one.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(item.regulations ?? []).map((r) => {
                        const batches = item.regulationBatches?.[r];
                        return (
                          <Badge key={r} variant="secondary" className="text-xs">
                            {r}{batches ? ` — ${batches}` : ""}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Remove course from catalog?"
        description={deleteTarget ? `"${deleteTarget.name}" will no longer be available to select. Courses already in use can't be deleted.` : undefined}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={isDeleting}
      />
    </Card>
  );
}
