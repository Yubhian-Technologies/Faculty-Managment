"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Plus, Pencil, Trash2, Check, X, BadgeCheck } from "lucide-react";
import { toast } from "@/hooks/useToast";
import type { DesignationCadre, DesignationCategory, DesignationCatalogItem } from "@/types";

const CADRE_OPTIONS: { value: DesignationCadre; label: string }[] = [
  { value: "PROFESSOR", label: "Professor" },
  { value: "ASSOCIATE_PROFESSOR", label: "Associate Professor" },
  { value: "ASSISTANT_PROFESSOR", label: "Assistant Professor" },
];
const NO_CADRE = "__none__"; // sentinel - Radix Select rejects "" as a value

type Draft = { name: string; cadre: string };
const EMPTY_DRAFT: Draft = { name: "", cadre: NO_CADRE };

const TITLE_BY_CATEGORY: Record<DesignationCategory, string> = {
  FACULTY: "Faculty Designations",
  TECHNICAL: "Technical Staff Designations",
  NON_TECHNICAL: "Non-Technical Staff Designations",
};
const DESCRIPTION_BY_CATEGORY: Record<DesignationCategory, string> = {
  FACULTY: "The job titles Faculty can be added/hired under - departments only select from these. Tag one as a Professor/Associate/Assistant Professor cadre to keep AICTE cadre-ratio reporting working even with a custom title.",
  TECHNICAL: "The job titles your department's Technical Staff can be added under.",
  NON_TECHNICAL: "The job titles Non-Technical Staff can be added under.",
};

interface DesignationCatalogCardProps {
  category: DesignationCategory;
}

// Admin-curated designation list for one category (Faculty / Technical /
// Non-Technical Supporting Staff) - same "add it here once, pick it
// everywhere else" model as CourseCatalogSettingsCard, deliberately simpler
// (no nested sub-editor) since a designation is just a name plus an optional
// AICTE cadre tag.
export function DesignationCatalogCard({ category }: DesignationCatalogCardProps) {
  const [items, setItems] = useState<DesignationCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isAdding, setIsAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DesignationCatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function load() {
    return fetch(`/api/college/designations?category=${category}`)
      .then((r) => r.json() as Promise<{ items: DesignationCatalogItem[] }>)
      .then((d) => setItems(d.items ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load designations" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Wrapped so the setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect).
    void (async () => {
      setIsLoading(true);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  async function addItem() {
    const name = newDraft.name.trim();
    if (!name) { toast({ variant: "destructive", title: "Enter a designation name" }); return; }
    setIsAdding(true);
    try {
      const res = await fetch("/api/college/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          ...(newDraft.cadre !== NO_CADRE ? { cadre: newDraft.cadre } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to add designation");
      }
      setNewDraft(EMPTY_DRAFT);
      toast({ variant: "success", title: "Designation added" });
      void load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to add designation" });
    } finally {
      setIsAdding(false);
    }
  }

  function startEdit(item: DesignationCatalogItem) {
    setEditingId(item.id);
    setEditDraft({ name: item.name, cadre: item.cadre ?? NO_CADRE });
  }

  async function saveEdit(id: string) {
    const name = editDraft.name.trim();
    if (!name) { toast({ variant: "destructive", title: "Enter a designation name" }); return; }
    setBusyId(id);
    try {
      const res = await fetch(`/api/college/designations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cadre: editDraft.cadre === NO_CADRE ? null : editDraft.cadre }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to update designation");
      }
      setEditingId(null);
      toast({ variant: "success", title: "Designation updated" });
      void load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to update designation" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(item: DesignationCatalogItem) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/college/designations/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      if (!res.ok) throw new Error();
      void load();
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
      const res = await fetch(`/api/college/designations/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to delete designation");
      }
      toast({ variant: "success", title: "Designation removed" });
      setDeleteTarget(null);
      void load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to delete designation" });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BadgeCheck className="h-4 w-4" /> {TITLE_BY_CATEGORY[category]}
        </CardTitle>
        <CardDescription>{DESCRIPTION_BY_CATEGORY[category]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1.5 flex-1 min-w-40">
            <Label className="text-xs">Designation Name</Label>
            <Input
              value={newDraft.name}
              onChange={(e) => setNewDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={category === "FACULTY" ? "e.g. Professor" : "e.g. Lab Assistant"}
            />
          </div>
          {category === "FACULTY" && (
            <div className="space-y-1.5">
              <Label className="text-xs">AICTE Cadre (optional)</Label>
              <Select value={newDraft.cadre} onValueChange={(v) => setNewDraft((d) => ({ ...d, cadre: v }))}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CADRE}>None</SelectItem>
                  {CADRE_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={() => void addItem()} loading={isAdding}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No designations yet. Add them above so they can be selected elsewhere.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const isEditing = editingId === item.id;
              const busy = busyId === item.id;
              return (
                <li key={item.id} className="p-3 flex flex-wrap items-center gap-3">
                  {isEditing ? (
                    <>
                      <Input
                        value={editDraft.name}
                        onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                        className="flex-1 min-w-40"
                      />
                      {category === "FACULTY" && (
                        <Select value={editDraft.cadre} onValueChange={(v) => setEditDraft((d) => ({ ...d, cadre: v }))}>
                          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CADRE}>None</SelectItem>
                            {CADRE_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="flex gap-1 ml-auto">
                        <Button size="icon" variant="ghost" onClick={() => void saveEdit(item.id)} loading={busy} aria-label="Save">
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
                        {item.cadre && (
                          <p className="text-xs text-muted-foreground">
                            Counts as {CADRE_OPTIONS.find((c) => c.value === item.cadre)?.label ?? item.cadre} cadre
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 ml-auto">
                        <Button size="sm" variant="ghost" onClick={() => void toggleActive(item)} disabled={busy}>
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
        title="Remove this designation?"
        description={deleteTarget ? `"${deleteTarget.name}" will no longer be selectable. Designations already in use can't be deleted.` : undefined}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void confirmDelete()}
        loading={isDeleting}
      />
    </Card>
  );
}
