"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Plus, Pencil, Trash2, Check, X, Contact } from "lucide-react";
import { toast } from "@/hooks/useToast";
import type { HonorificCatalogItem } from "@/types";

// Admin-curated honorific list (Mr., Mrs., Dr., Prof., ...) - same
// "add it here once, pick it everywhere else" model as DesignationCatalogCard,
// deliberately simpler (just a name, no category/cadre split).
export function HonorificsCatalogCard() {
  const [items, setItems] = useState<HonorificCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<HonorificCatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function load() {
    return fetch("/api/college/honorifics")
      .then((r) => r.json() as Promise<{ items: HonorificCatalogItem[] }>)
      .then((d) => setItems(d.items ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load honorifics" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Wrapped so the setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect).
    void (async () => {
      setIsLoading(true);
      await load();
    })();
  }, []);

  async function addItem() {
    const name = newName.trim();
    if (!name) { toast({ variant: "destructive", title: "Enter an honorific" }); return; }
    setIsAdding(true);
    try {
      const res = await fetch("/api/college/honorifics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to add honorific");
      }
      setNewName("");
      toast({ variant: "success", title: "Honorific added" });
      void load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to add honorific" });
    } finally {
      setIsAdding(false);
    }
  }

  function startEdit(item: HonorificCatalogItem) {
    setEditingId(item.id);
    setEditName(item.name);
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) { toast({ variant: "destructive", title: "Enter an honorific" }); return; }
    setBusyId(id);
    try {
      const res = await fetch(`/api/college/honorifics/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to update honorific");
      }
      setEditingId(null);
      toast({ variant: "success", title: "Honorific updated" });
      void load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to update honorific" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(item: HonorificCatalogItem) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/college/honorifics/${item.id}`, {
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
      const res = await fetch(`/api/college/honorifics/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to delete honorific");
      }
      toast({ variant: "success", title: "Honorific removed" });
      setDeleteTarget(null);
      void load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to delete honorific" });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Contact className="h-4 w-4" /> Honorifics
        </CardTitle>
        <CardDescription>
          The name prefixes (Mr., Mrs., Dr., Prof., ...) available to pick across the college.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1.5 flex-1 min-w-40">
            <Label className="text-xs">Honorific</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Dr."
              onKeyDown={(e) => { if (e.key === "Enter") void addItem(); }}
            />
          </div>
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
            No honorifics yet. Add them above (e.g. Mr., Mrs., Dr., Prof.) so they can be selected elsewhere.
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
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 min-w-40"
                        onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(item.id); }}
                      />
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
        title="Remove this honorific?"
        description={deleteTarget ? `"${deleteTarget.name}" will no longer be selectable.` : undefined}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void confirmDelete()}
        loading={isDeleting}
      />
    </Card>
  );
}
