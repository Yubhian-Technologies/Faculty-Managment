"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { builtInCategories, categoryKey, checkCategoryDefinition, isStandardCategoryCode, parseCategoryLines, type CategoryDefinition } from "@/lib/subjects/categoryDefinitions";

// The Add/List/Edit/Delete category UI, shared by the standalone
// /academics/categories page and the inline dialog opened from Course
// Structure and Import Subjects - one implementation, so a category defined
// from either place behaves identically. `initialText` seeds the Add
// textarea (e.g. the exact values an import just rejected); give the host
// a fresh `key` when that seed value changes, since this component keeps
// its own state once mounted.
export function CategoriesManager({ initialText = "", onChanged }: { initialText?: string; onChanged?: () => void }) {
  const standard = useMemo(() => builtInCategories(), []);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [text, setText] = useState(initialText);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // originalCode identifies which doc is being edited (the PATCH query key);
  // code is the (possibly changed) value typed so far - only a custom
  // category's code input is ever shown, so isStandard locks it unchanged.
  const [editing, setEditing] = useState<{ originalCode: string; code: string; fullForm: string; isStandard: boolean } | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleting, setDeleting] = useState<CategoryDefinition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/college/subject-categories");
      const json = await res.json() as { categories?: CategoryDefinition[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setCategories(json.categories ?? []);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load categories.");
    } finally {
      setIsLoading(false);
    }
  }
  useEffect(() => {
    void (async () => { await load(); })();
  }, []);

  // Custom-only rows for the main table - a standard code the college has
  // relabeled lives in `categories` too (same collection, see
  // subject-categories/route.ts), but is rendered in the standard table below
  // instead, merged with its default so it isn't shown twice.
  const customOnly = useMemo(() => categories.filter((c) => !isStandardCategoryCode(c.code)), [categories]);
  const effectiveStandard = useMemo(() => standard.map((s) => {
    const override = categories.find((c) => categoryKey(c.code) === categoryKey(s.code));
    return { code: s.code, fullForm: override?.fullForm ?? s.fullForm, isOverridden: !!override };
  }), [standard, categories]);

  // Checked here as the API will check them, so a mistake shows before Add.
  const draft = useMemo(() => {
    const { entries, errors } = parseCategoryLines(text);
    const accepted: CategoryDefinition[] = [];
    for (const entry of entries) {
      const check = checkCategoryDefinition(entry, [...categories, ...accepted]);
      if (!check.ok) errors.push(check.error);
      else accepted.push({ code: check.code, fullForm: check.fullForm });
    }
    return { accepted, errors };
  }, [text, categories]);

  async function handleAdd() {
    if (draft.errors.length > 0 || draft.accepted.length === 0) return;
    setIsAdding(true);
    setAddError("");
    try {
      const res = await fetch("/api/college/subject-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: draft.accepted }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setAddError(json.error ?? "Couldn't add the categories."); return; }
      toast({ variant: "success", title: `${draft.accepted.length} categor${draft.accepted.length === 1 ? "y" : "ies"} added` });
      setText("");
      await load();
      onChanged?.();
    } catch {
      setAddError("Network error. Nothing was added.");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setIsSavingEdit(true);
    setEditError("");
    try {
      const codeChanged = !editing.isStandard && categoryKey(editing.code) !== categoryKey(editing.originalCode);
      const res = await fetch("/api/college/subject-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editing.originalCode, fullForm: editing.fullForm, ...(codeChanged ? { newCode: editing.code } : {}) }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setEditError(json.error ?? "Couldn't save."); return; }
      setEditing(null);
      await load();
      onChanged?.();
    } catch {
      setEditError("Network error. Nothing was saved.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/subject-categories?code=${encodeURIComponent(deleting.code)}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Couldn't remove the category" });
        return;
      }
      toast({ variant: "success", title: isStandardCategoryCode(deleting.code) ? `${deleting.code} reset to its default label` : `${deleting.code} removed` });
      await load();
      onChanged?.();
    } catch {
      toast({ variant: "destructive", title: "Network error. Nothing was changed." });
    } finally {
      setIsDeleting(false);
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Add categories</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="category-lines">One per line, as CODE: Full form</Label>
            <Textarea
              id="category-lines"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"PC: Professional Core\nES: Engineering Sciences\nBS&H: Basic Sciences and Humanities"}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Codes use letters, digits and &amp; - / . (up to 12 characters). You can paste two spreadsheet columns as they are.
              The standard categories below are always available - edit one directly in its own row to relabel it.
            </p>
          </div>
          {(draft.errors.length > 0 || addError) && (
            <ul className="space-y-1 text-sm text-red-600">
              {[...draft.errors, ...(addError ? [addError] : [])].map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <Button onClick={() => void handleAdd()} loading={isAdding} disabled={isAdding || draft.accepted.length === 0 || draft.errors.length > 0}>
            {draft.accepted.length > 1 ? `Add ${draft.accepted.length} categories` : "Add category"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Categories</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loadError && <p className="px-6 pb-4 text-sm text-red-600">{loadError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-6 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Full form</th>
                  <th className="px-6 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customOnly.map((c) => (
                  <tr key={c.code} className="border-b align-top">
                    <td className="px-6 py-2 font-mono">
                      {editing?.originalCode === c.code ? (
                        <Input
                          aria-label={`Code for ${c.code}`}
                          value={editing.code}
                          onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                          onKeyDown={(e) => { if (e.key === "Enter") void handleSaveEdit(); if (e.key === "Escape") setEditing(null); }}
                          className="font-mono"
                        />
                      ) : c.code}
                    </td>
                    <td className="px-3 py-2">
                      {editing?.originalCode === c.code ? (
                        <div className="space-y-1">
                          <Input
                            aria-label={`Full form for ${c.code}`}
                            value={editing.fullForm}
                            onChange={(e) => setEditing({ ...editing, fullForm: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") void handleSaveEdit(); if (e.key === "Escape") setEditing(null); }}
                            autoFocus
                          />
                          {editError && <p className="text-xs text-red-600">{editError}</p>}
                        </div>
                      ) : c.fullForm}
                    </td>
                    <td className="px-6 py-2 text-right whitespace-nowrap">
                      {editing?.originalCode === c.code ? (
                        <>
                          <Button size="sm" onClick={() => void handleSaveEdit()} loading={isSavingEdit}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setEditError(""); }}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing({ originalCode: c.code, code: c.code, fullForm: c.fullForm, isStandard: false }); setEditError(""); }}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeleting(c)}>Remove</Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!isLoading && customOnly.length === 0 && !loadError && (
                  <tr className="border-b"><td colSpan={3} className="px-6 py-3 text-muted-foreground">No custom categories defined yet. Add the ones your Course Structure files use.</td></tr>
                )}
                {effectiveStandard.map((c) => (
                  <tr key={c.code} className="border-b align-top text-muted-foreground">
                    <td className="px-6 py-2 font-mono" title="A standard category's code can't be changed, only its full form.">{c.code}</td>
                    <td className="px-3 py-2">
                      {editing?.originalCode === c.code ? (
                        <div className="space-y-1">
                          <Input
                            aria-label={`Full form for ${c.code}`}
                            value={editing.fullForm}
                            onChange={(e) => setEditing({ ...editing, fullForm: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") void handleSaveEdit(); if (e.key === "Escape") setEditing(null); }}
                            autoFocus
                          />
                          {editError && <p className="text-xs text-red-600">{editError}</p>}
                        </div>
                      ) : c.fullForm}
                    </td>
                    <td className="px-6 py-2 text-right whitespace-nowrap text-xs">
                      {editing?.originalCode === c.code ? (
                        <>
                          <Button size="sm" onClick={() => void handleSaveEdit()} loading={isSavingEdit}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setEditError(""); }}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <span className="mr-2">Standard</span>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing({ originalCode: c.code, code: c.code, fullForm: c.fullForm, isStandard: true }); setEditError(""); }}>Edit</Button>
                          {c.isOverridden && (
                            <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}>Reset</Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting && isStandardCategoryCode(deleting.code) ? `Reset ${deleting.code} to its default label?` : `Remove ${deleting?.code}?`}
        description={
          deleting && isStandardCategoryCode(deleting.code)
            ? `${deleting.fullForm} reverts to its standard label. The category itself stays defined - existing subjects are unaffected.`
            : `${deleting?.fullForm}. Files can no longer use this category until it is defined again. A category that existing subjects use can't be removed.`
        }
        confirmLabel={deleting && isStandardCategoryCode(deleting.code) ? "Reset" : "Remove"}
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

// Same prefill convention as the standalone page's own ?add= handling:
// "Audit Course|SEC" -> one "CODE: Full form" line per value.
export function categoryPrefillText(values: string[]): string {
  return values
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => `${/^[A-Za-z0-9&\-/.]{1,12}$/.test(v) ? v.toUpperCase() : ""}: ${/^[A-Za-z0-9&\-/.]{1,12}$/.test(v) ? "" : v}`)
    .join("\n");
}
