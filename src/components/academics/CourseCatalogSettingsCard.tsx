"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Plus, Pencil, Trash2, Check, X, GraduationCap } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import type { CourseCatalogItem } from "@/types";

type Draft = { name: string; code: string; durationYears: string };
const EMPTY_DRAFT: Draft = { name: "", code: "", durationYears: "4" };

export function CourseCatalogSettingsCard() {
  const [items, setItems] = useState<CourseCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => { load(); }, []);

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
    setEditDraft({ name: item.name, code: item.code, durationYears: String(item.durationYears) });
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
          course names and codes consistent and prevents duplicates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Add new */}
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_120px_auto] sm:items-end rounded-lg border bg-muted/30 p-3">
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
              const isEditing = editingId === item.id;
              const busy = busyId === item.id;
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 p-3">
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
                    </>
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
