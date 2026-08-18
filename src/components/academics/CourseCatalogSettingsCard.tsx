"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Plus, Pencil, Trash2, Check, X, GraduationCap, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import type { AcademicRegulationSettings, CourseCatalogItem } from "@/types";

type Draft = { name: string; code: string; durationYears: string; regulations: string[]; regulationYears: Record<string, number[]> };
const EMPTY_DRAFT: Draft = { name: "", code: "", durationYears: "4", regulations: [], regulationYears: {} };

function yearsForDuration(durationYears: string) {
  const n = Number(durationYears) || 0;
  return Array.from({ length: Math.min(Math.max(n, 0), 10) }, (_, i) => i + 1);
}

// Inline "which years is this regulation offered for" row, shown under each
// active regulation badge - unchecked/empty means unrestricted (every year),
// so nothing needs configuring here until a Principal wants to narrow one
// down (e.g. an outgoing regulation kept only for its remaining senior years).
function RegulationYearsRow({
  draft, setDraft, code, onToggleYear,
}: { draft: Draft; setDraft: (d: Draft) => void; code: string; onToggleYear: (draft: Draft, setDraft: (d: Draft) => void, code: string, year: number) => void }) {
  const years = yearsForDuration(draft.durationYears);
  const active = draft.regulationYears[code] ?? [];
  if (years.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-1">
      <span className="text-[11px] text-muted-foreground">{code} years:</span>
      {years.map((y) => {
        const on = active.includes(y);
        return (
          <button
            key={y}
            type="button"
            onClick={() => onToggleYear(draft, setDraft, code, y)}
            className={`h-5 min-w-5 rounded px-1 text-[11px] border ${on ? "bg-secondary border-secondary-foreground/20" : "border-input text-muted-foreground"}`}
          >
            {y}
          </button>
        );
      })}
      <span className="text-[11px] text-muted-foreground">{active.length === 0 ? "(all years)" : ""}</span>
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
  // The college's declared regulation codes (Settings > Academic Regulations,
  // see RegulationSettingsCard) - each catalog entry picks the subset that's
  // actually valid for that course. A course with none picked here blocks the
  // Dean from adding subjects to it until the Principal sets this, AND a
  // regulation left out here is invisible to the Dean even if it's declared
  // college-wide and even if RegulationSettingsCard's own per-year mapping
  // points at it (that mapping only fixes ONE default regulation per year,
  // for browsing convenience - see currentRegulation in dean/subjects/page.tsx
  // - it was never meant to be an exhaustive list of what a course may use;
  // a course can legitimately run more than one regulation at once, e.g. R23
  // for continuing students alongside R26 for a fresh intake in the same
  // year). So the default here is simply every declared regulation, not a
  // narrower guess derived from any one year's fixed value.
  const [declaredRegulations, setDeclaredRegulations] = useState<string[]>([]);

  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isAdding, setIsAdding] = useState(false);
  // False the moment the Principal manually toggles a chip on the add form -
  // once they've made an explicit choice, the auto-fill below must never
  // overwrite it again for this draft.
  const [regulationsAutoFilled, setRegulationsAutoFilled] = useState(true);

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
    if (readOnly) return;
    fetch("/api/college/settings/regulations")
      .then((r) => r.json() as Promise<{ settings: AcademicRegulationSettings }>)
      .then((d) => setDeclaredRegulations(d.settings.regulations ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load regulations" }));
  }, [readOnly]);

  // Derived, not effect-synced state: as long as the Principal hasn't
  // touched a chip by hand for this draft, the effective selection just
  // tracks declaredRegulations live (nothing to keep in sync). The moment
  // they toggle one manually (toggleNewDraftRegulation), newDraft.regulations
  // itself takes over.
  const effectiveNewRegulations = regulationsAutoFilled ? declaredRegulations : newDraft.regulations;

  function toggleRegulation(draft: Draft, setDraft: (d: Draft) => void, code: string) {
    const isRemoving = draft.regulations.includes(code);
    const regulationYears = { ...draft.regulationYears };
    // Removing a regulation drops its year-scoping too - re-adding it later
    // starts fresh (unrestricted) rather than resurrecting a stale mapping.
    if (isRemoving) delete regulationYears[code];
    setDraft({
      ...draft,
      regulations: isRemoving
        ? draft.regulations.filter((r) => r !== code)
        : [...draft.regulations, code],
      regulationYears,
    });
  }

  // Which years (within the draft's own duration) a regulation is offered
  // for - empty means unrestricted (every year), the default until narrowed.
  function toggleRegulationYear(draft: Draft, setDraft: (d: Draft) => void, code: string, year: number) {
    const current = draft.regulationYears[code] ?? [];
    const next = current.includes(year) ? current.filter((y) => y !== year) : [...current, year].sort((a, b) => a - b);
    const regulationYears = { ...draft.regulationYears };
    if (next.length === 0) delete regulationYears[code]; else regulationYears[code] = next;
    setDraft({ ...draft, regulationYears });
  }

  function toggleNewDraftRegulation(code: string) {
    const base = effectiveNewRegulations;
    setRegulationsAutoFilled(false);
    setNewDraft((d) => ({
      ...d,
      regulations: base.includes(code) ? base.filter((r) => r !== code) : [...base, code],
    }));
  }

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
          regulations: effectiveNewRegulations,
          regulationYears: newDraft.regulationYears,
        }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to add course");
      }
      setNewDraft(EMPTY_DRAFT);
      setRegulationsAutoFilled(true);
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
      // A course stuck with none picked starts from every declared
      // regulation instead of blank, so opening Edit gives the Principal
      // something to just confirm (or narrow down) rather than an empty
      // click-fest. A course that already has regulations keeps them as-is.
      regulations: item.regulations?.length ? item.regulations : declaredRegulations,
      regulationYears: item.regulationYears ?? {},
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
          regulationYears: editDraft.regulationYears,
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

  // One click straight from the "No regulations assigned yet" warning - no
  // need to open Edit, notice the chips came pre-filled, and remember to
  // hit Save. Assigns every declared regulation, same default startEdit
  // pre-fills with - otherwise there's nothing to auto-assign (nothing
  // declared yet) and Edit is still the only way in, same as before this
  // existed.
  async function quickAssignRegulations(item: CourseCatalogItem) {
    const regulations = declaredRegulations;
    if (regulations.length === 0) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/college/course-catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regulations }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to assign regulations");
      }
      toast({ variant: "success", title: `Assigned ${regulations.join(", ")}` });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to assign regulations" });
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
          course names and codes consistent and prevents duplicates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Add new */}
        {!readOnly && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
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
                <Label className="text-xs">Years</Label>
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
            <div className="space-y-1.5">
              <Label className="text-xs">Regulations that apply to this course</Label>
              {declaredRegulations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Declare regulation codes under Academic Regulations below first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {declaredRegulations.map((r) => {
                    const active = effectiveNewRegulations.includes(r);
                    return (
                      <Badge
                        key={r}
                        variant={active ? "secondary" : "outline"}
                        className="cursor-pointer text-xs"
                        onClick={() => toggleNewDraftRegulation(r)}
                      >
                        {active && <Check className="h-3 w-3 mr-1" />}{r}
                      </Badge>
                    );
                  })}
                </div>
              )}
              {effectiveNewRegulations.length > 0 && (
                <div className="space-y-1 pt-1">
                  {effectiveNewRegulations.map((code) => (
                    <RegulationYearsRow key={code} draft={newDraft} setDraft={setNewDraft} code={code} onToggleYear={toggleRegulationYear} />
                  ))}
                </div>
              )}
              {regulationsAutoFilled && effectiveNewRegulations.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Pre-filled with every declared regulation - click a badge to narrow it down.
                </p>
              )}
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
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {declaredRegulations.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No regulations declared yet.</p>
                        ) : (
                          declaredRegulations.map((r) => {
                            const active = editDraft.regulations.includes(r);
                            return (
                              <Badge
                                key={r}
                                variant={active ? "secondary" : "outline"}
                                className="cursor-pointer text-xs"
                                onClick={() => toggleRegulation(editDraft, setEditDraft, r)}
                              >
                                {active && <Check className="h-3 w-3 mr-1" />}{r}
                              </Badge>
                            );
                          })
                        )}
                      </div>
                      {editDraft.regulations.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {editDraft.regulations.map((code) => (
                            <RegulationYearsRow key={code} draft={editDraft} setDraft={setEditDraft} code={code} onToggleYear={toggleRegulationYear} />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (item.regulations ?? []).length === 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3" /> No regulations assigned yet - subjects can&apos;t be added to this course until you assign at least one.
                      </p>
                      {!readOnly && declaredRegulations.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          disabled={busy}
                          loading={busy}
                          onClick={() => quickAssignRegulations(item)}
                        >
                          Assign {declaredRegulations.join(", ")}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(item.regulations ?? []).map((r) => {
                        const years = item.regulationYears?.[r];
                        return (
                          <Badge key={r} variant="secondary" className="text-xs">
                            {r}{years && years.length > 0 ? ` (Y${years.join(",")})` : ""}
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
