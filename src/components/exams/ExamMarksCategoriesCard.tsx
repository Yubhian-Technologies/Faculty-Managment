"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardPaste, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import type { Course, ExamMarksCategory, Subject } from "@/types";

// Exam Cell > Mid Configuration > Marks > Marks categories: a named internal
// marks breakdown (e.g. "Theory - no Quiz": Mid 25 + Assignment 5) and the
// subjects that use it - added many at a time (tick them, or paste their codes).
// A subject in a category uses its breakdown in every branch; the rest keep
// their branch's configuration. Nothing changes for a subject with marks entered.

interface Row { id?: string; name: string; maxMarks: string }
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const blankRows = (): Row[] => [{ name: "Mid", maxMarks: "" }, { name: "Quiz", maxMarks: "" }, { name: "Assignment", maxMarks: "" }];

/** The breakdown form (name, type, internal / external max, components) - for a new category or editing one. */
function BreakdownForm({ initial, onSave, onCancel, saving, isNew }: {
  initial?: ExamMarksCategory; isNew: boolean; saving: boolean; onCancel: () => void;
  onSave: (v: { name: string; examType: string; internalMaxMarks: number; externalMaxMarks: number; components: { id?: string; name: string; maxMarks: number; order: number; isActive: boolean }[] }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [examType, setExamType] = useState(initial?.examType ?? "THEORY");
  const [internal, setInternal] = useState(String(initial?.internalMaxMarks ?? 30));
  const [external, setExternal] = useState(String(initial?.externalMaxMarks ?? 70));
  const [rows, setRows] = useState<Row[]>(initial ? [...initial.components].filter((c) => c.isActive).sort((a, b) => a.order - b.order).map((c) => ({ id: c.id, name: c.name, maxMarks: String(c.maxMarks) })) : blankRows());
  const total = rows.reduce((n, r) => n + (Number(r.maxMarks) || 0), 0);
  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="emc-name">Category name</Label><Input id="emc-name" value={name} maxLength={80} placeholder="e.g. Theory - no Quiz" onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="emc-type">Subjects</Label>
          <select id="emc-type" className={selectClass} value={examType} disabled={!isNew} onChange={(e) => setExamType(e.target.value as "THEORY" | "LAB")}>
            <option value="THEORY">Theory</option><option value="LAB">Lab</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label htmlFor="emc-int">Internal</Label><Input id="emc-int" type="number" min={1} value={internal} onChange={(e) => setInternal(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="emc-ext">External</Label><Input id="emc-ext" type="number" min={0} value={external} onChange={(e) => setExternal(e.target.value)} /></div>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Components</legend>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input aria-label={`Component ${i + 1} name`} value={r.name} placeholder="e.g. Mid" className="flex-1 bg-background" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
            <Input aria-label={`Component ${i + 1} marks`} type="number" min={1} value={r.maxMarks} placeholder="Marks" className="w-28 bg-background" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, maxMarks: e.target.value } : y)))} />
            <Button size="icon" variant="ghost" aria-label={`Remove component ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button size="sm" variant="outline" onClick={() => setRows((x) => [...x, { name: "", maxMarks: "" }])}><Plus className="mr-1 h-4 w-4" />Add component</Button>
          <span className={cn("text-xs font-medium", total === Number(internal) ? "text-emerald-700" : "text-destructive")}>Total {total} of {Number(internal) || 0}</span>
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} disabled={!name.trim() || total !== Number(internal) || rows.some((r) => !r.name.trim() || !(Number(r.maxMarks) > 0))}
          onClick={() => onSave({ name, examType, internalMaxMarks: Number(internal), externalMaxMarks: Number(external), components: rows.map((r, i) => ({ id: r.id, name: r.name, maxMarks: Number(r.maxMarks), order: i, isActive: true })) })}>
          {isNew ? "Create category" : "Save breakdown"}
        </Button>
      </div>
    </div>
  );
}

/** Add subjects to a category: tick them from a course's list, or paste their codes. */
function AddSubjects({ category, all, onDone }: { category: ExamMarksCategory; all: ExamMarksCategory[]; onDone: (c: ExamMarksCategory) => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [reg, setReg] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [codes, setCodes] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => buildCourseGroups(courses).filter((g) => !g.key.startsWith("name:")), [courses]);
  useEffect(() => { fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined); }, []);
  useEffect(() => {
    if (!courseKey) return;
    let cancelled = false;
    fetch(`/api/college/subjects?catalogId=${encodeURIComponent(courseKey)}`).then((r) => r.json() as Promise<{ subjects?: Subject[] }>)
      .then((d) => { if (!cancelled) setSubjects((d.subjects ?? []).filter((s) => (s.type === "PRACTICAL" ? "LAB" : "THEORY") === category.examType).sort((a, b) => a.code.localeCompare(b.code))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [courseKey, category.examType]);

  const elsewhere = (id: string) => all.find((c) => c.id !== category.id && c.examType === category.examType && c.subjectIds.includes(id))?.name;
  const regs = [...new Set(subjects.map((s) => s.regulation ?? "").filter(Boolean))].sort();
  const shown = subjects.filter((s) => (!reg || s.regulation === reg) && (!q || `${s.code} ${s.name}`.toLowerCase().includes(q.toLowerCase())) && !category.subjectIds.includes(s.id));
  const pickable = shown.filter((s) => !elsewhere(s.id));

  async function add(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-marks-categories/${encodeURIComponent(category.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { error?: string; category?: ExamMarksCategory; skipped?: { subject: string; reason: string }[] };
      if (!res.ok || !data.category) throw new Error(data.error ?? "Could not add");
      const added = data.category.subjectIds.length - category.subjectIds.length;
      toast({ variant: added > 0 ? "success" : "destructive", title: `${added} subject${added === 1 ? "" : "s"} added`, description: data.skipped?.length ? `Skipped: ${data.skipped.map((x) => `${x.subject} (${x.reason})`).join("; ")}` : undefined });
      setPicked(new Set()); setCodes("");
      onDone(data.category);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not add" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed p-4">
      <p className="text-sm font-semibold">Add subjects</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <select aria-label="Course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setSubjects([]); setReg(""); setPicked(new Set()); }}>
          <option value="">Select a course</option>
          {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
        <select aria-label="Regulation" className={selectClass} value={reg} disabled={regs.length === 0} onChange={(e) => setReg(e.target.value)}>
          <option value="">All regulations</option>
          {regs.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search subjects" className="pl-9" placeholder="Search code or name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {courseKey && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{shown.length} subject{shown.length === 1 ? "" : "s"} shown · {picked.size} ticked</span>
            {pickable.length > 0 && <button type="button" className="font-medium text-primary underline" onClick={() => setPicked((p) => new Set([...p, ...pickable.map((s) => s.id)]))}>Tick all shown</button>}
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border bg-background p-2">
            {shown.length === 0 && <li className="p-2 text-sm text-muted-foreground">No subjects to add.</li>}
            {shown.map((s) => {
              const other = elsewhere(s.id);
              return (
                <li key={s.id}>
                  <label className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", other ? "opacity-50" : "cursor-pointer hover:bg-muted/50")}>
                    <Checkbox checked={picked.has(s.id)} disabled={Boolean(other)} onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(s.id); else n.delete(s.id); return n; })} />
                    <span className="w-28 shrink-0 font-mono text-xs">{s.code}</span><span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{other ? `in "${other}"` : s.regulation}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end"><Button size="sm" loading={busy} disabled={picked.size === 0} onClick={() => void add({ add: [...picked] })}>Add {picked.size || ""} ticked</Button></div>
          <div className="space-y-1.5 border-t pt-3">
            <Label htmlFor={`codes-${category.id}`} className="flex items-center gap-1.5"><ClipboardPaste className="h-4 w-4" />Or paste subject codes</Label>
            <Textarea id={`codes-${category.id}`} rows={2} value={codes} placeholder="e.g. UG26CS1T01, UG26MA1T02 (commas, spaces or one per line)" onChange={(e) => setCodes(e.target.value)} />
            <div className="flex justify-end"><Button size="sm" variant="outline" loading={busy} disabled={!codes.trim()} onClick={() => void add({ addCodes: codes.split(/[\s,;]+/).filter(Boolean), catalogId: courseKey })}>Add by codes</Button></div>
          </div>
        </>
      )}
    </div>
  );
}

export function ExamMarksCategoriesCard() {
  const [categories, setCategories] = useState<ExamMarksCategory[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExamMarksCategory | null>(null);

  function load() {
    fetch("/api/college/exam-marks-categories").then((r) => r.json() as Promise<{ categories?: ExamMarksCategory[] }>).then((d) => setCategories(d.categories ?? []))
      .catch(() => { setCategories([]); toast({ variant: "destructive", title: "Failed to load the marks categories" }); });
  }
  useEffect(load, []);
  const replace = (c: ExamMarksCategory) => setCategories((list) => (list ?? []).map((x) => (x.id === c.id ? c : x)));

  async function send(url: string, method: string, body: unknown, ok: string): Promise<ExamMarksCategory | null> {
    setSaving(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { error?: string; category?: ExamMarksCategory; skipped?: { subject: string; reason: string }[] };
      if (!res.ok || !data.category) throw new Error(data.error ?? "Could not save");
      toast({ variant: "success", title: ok, description: data.skipped?.length ? `Not removed: ${data.skipped.map((x) => `${x.subject} (${x.reason})`).join("; ")}` : undefined });
      return data.category;
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const res = await fetch(`/api/college/exam-marks-categories/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) toast({ variant: "destructive", title: data.error ?? "Could not delete" });
    setDeleting(null);
    load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Marks categories</CardTitle>
          <CardDescription className="mt-1.5">
            For subjects whose internal marks differ from their branch&rsquo;s breakdown: make a category (e.g. &ldquo;Theory - no Quiz&rdquo;: Mid 25 + Assignment 5) and add the subjects to it.
            They use it in every branch; all other subjects keep their branch&rsquo;s configuration. Nothing changes for a subject once marks are entered for it.
          </CardDescription>
        </div>
        {!creating && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />New category</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        {creating && (
          <BreakdownForm isNew saving={saving} onCancel={() => setCreating(false)}
            onSave={async (v) => { const c = await send("/api/college/exam-marks-categories", "POST", v, "Category created - now add its subjects"); if (c) { setCreating(false); setCategories((l) => [...(l ?? []), c]); setOpen(c.id); } }} />
        )}
        {categories === null ? <div className="h-24 animate-pulse rounded-xl bg-muted" /> : categories.length === 0 && !creating ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No categories yet - every subject uses its branch&rsquo;s breakdown.</p>
        ) : categories.map((c) => {
          const isOpen = open === c.id;
          return (
            <div key={c.id} className="rounded-xl border">
              <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <span className="font-semibold">{c.name}</span>
                <Badge variant="secondary">{c.examType === "LAB" ? "Lab" : "Theory"}</Badge>
                <span className="flex flex-wrap gap-1">{c.components.filter((x) => x.isActive).map((x) => <Badge key={x.id} variant="outline">{x.name} {x.maxMarks}</Badge>)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.internalMaxMarks} / {c.externalMaxMarks} · {c.subjectIds.length} subject{c.subjectIds.length === 1 ? "" : "s"}</span>
              </button>
              {isOpen && (
                <div className="space-y-4 border-t p-4">
                  {editing === c.id ? (
                    <BreakdownForm initial={c} isNew={false} saving={saving} onCancel={() => setEditing(null)}
                      onSave={async (v) => { const u = await send(`/api/college/exam-marks-categories/${encodeURIComponent(c.id)}`, "PATCH", v, "Breakdown saved"); if (u) { replace(u); setEditing(null); } }} />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(c.id)}><Pencil className="mr-1 h-4 w-4" />Edit breakdown</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(c)}><Trash2 className="mr-1 h-4 w-4" />Delete category</Button>
                    </div>
                  )}
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Code</th><th className="p-2">Subject</th><th className="p-2">Regulation</th><th className="p-2" /></tr></thead>
                      <tbody>
                        {c.subjects.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No subjects yet - add them below.</td></tr>}
                        {c.subjects.map((s) => (
                          <tr key={s.id} className="border-t">
                            <td className="p-2 font-mono text-xs">{s.code}</td><td className="p-2">{s.name}</td><td className="p-2 text-xs">{s.regulation || "-"}</td>
                            <td className="p-2 text-right">
                              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove ${s.code}`}
                                onClick={async () => { const u = await send(`/api/college/exam-marks-categories/${encodeURIComponent(c.id)}`, "PATCH", { remove: [s.id] }, `${s.code} removed`); if (u) replace(u); }}><X className="h-4 w-4" /></Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <AddSubjects category={c} all={categories} onDone={replace} />
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ""}"?`}
        description="Its subjects go back to their branch's breakdown. Not possible once marks are entered for any of them."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
