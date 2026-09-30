"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { builtInCategories, checkCategoryDefinition, parseCategoryLines, type CategoryDefinition } from "@/lib/subjects/categoryDefinitions";
import { ArrowLeft } from "lucide-react";

// Academics > Categories. The dean defines each subject category once, as a
// short code and its full form. Course Structure files may then use either in
// their Category column; a code or name that isn't defined here is rejected
// before anything is imported.

export default function CategoriesPage() {
  return (
    <Suspense fallback={null}>
      <CategoriesPageInner />
    </Suspense>
  );
}

function CategoriesPageInner() {
  const searchParams = useSearchParams();
  const standard = useMemo(() => builtInCategories(), []);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ?add=Audit Course|SEC pre-fills one "CODE: Full form" line per value, so
  // the categories a failed import named can be defined in one go.
  const [text, setText] = useState(() =>
    (searchParams.get("add") ?? "").split("|").map((v) => v.trim()).filter(Boolean).map((v) => `${/^[A-Za-z0-9&\-/.]{1,12}$/.test(v) ? v.toUpperCase() : ""}: ${/^[A-Za-z0-9&\-/.]{1,12}$/.test(v) ? "" : v}`).join("\n")
  );
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [editing, setEditing] = useState<{ code: string; fullForm: string } | null>(null);
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
      const res = await fetch("/api/college/subject-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setEditError(json.error ?? "Couldn't save."); return; }
      setEditing(null);
      await load();
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
      toast({ variant: "success", title: `${deleting.code} removed` });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Network error. Nothing was removed." });
    } finally {
      setIsDeleting(false);
      setDeleting(null);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Subject categories"
        description="Define each category as a short code and its full form. Course Structure files can then use the code or the full form in their Category column."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />

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
              The standard categories below are always available and can&apos;t be redefined.
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
                {categories.map((c) => (
                  <tr key={c.code} className="border-b align-top">
                    <td className="px-6 py-2 font-mono">{c.code}</td>
                    <td className="px-3 py-2">
                      {editing?.code === c.code ? (
                        <div className="space-y-1">
                          <Input
                            aria-label={`Full form for ${c.code}`}
                            value={editing.fullForm}
                            onChange={(e) => setEditing({ code: c.code, fullForm: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") void handleSaveEdit(); if (e.key === "Escape") setEditing(null); }}
                            autoFocus
                          />
                          {editError && <p className="text-xs text-red-600">{editError}</p>}
                        </div>
                      ) : c.fullForm}
                    </td>
                    <td className="px-6 py-2 text-right whitespace-nowrap">
                      {editing?.code === c.code ? (
                        <>
                          <Button size="sm" onClick={() => void handleSaveEdit()} loading={isSavingEdit}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setEditError(""); }}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing({ code: c.code, fullForm: c.fullForm }); setEditError(""); }}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeleting(c)}>Remove</Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!isLoading && categories.length === 0 && !loadError && (
                  <tr className="border-b"><td colSpan={3} className="px-6 py-3 text-muted-foreground">No categories defined yet. Add the ones your Course Structure files use.</td></tr>
                )}
                {standard.map((c) => (
                  <tr key={c.code} className="border-b text-muted-foreground">
                    <td className="px-6 py-2 font-mono">{c.code}</td>
                    <td className="px-3 py-2">{c.fullForm}</td>
                    <td className="px-6 py-2 text-right text-xs">Standard</td>
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
        title={`Remove ${deleting?.code}?`}
        description={`${deleting?.fullForm}. Files can no longer use this category until it is defined again. A category that existing subjects use can't be removed.`}
        confirmLabel="Remove"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
