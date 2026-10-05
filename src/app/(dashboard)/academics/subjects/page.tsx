"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { builtInCategories, type CategoryDefinition } from "@/lib/subjects/categoryDefinitions";
import { SUBJECT_TYPE_LABELS, type Subject, type SubjectType } from "@/types";
import { ArrowLeft, Plus } from "lucide-react";

// Academics > Subjects. View and manage the master subjects (course +
// regulation scoped) that Course Structure imports create. Uses the existing
// /api/college/subjects routes - nothing new server-side. The API refuses
// to hard-delete a subject that is still assigned or staffed (409 shown here).

type CourseOption = { id: string; name: string; isActive?: boolean };
type Form = {
  id?: string;
  courseId: string;
  regulation: string;
  serialNumber: string;
  category: string;
  name: string;
  code: string;
  shortCode: string;
  lectureHours: string;
  tutorialHours: string;
  practicalHours: string;
  credits: string;
  type: SubjectType;
};

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const emptyForm = (courseId: string, regulation: string): Form => ({
  courseId, regulation, serialNumber: "", category: "", name: "", code: "", shortCode: "",
  lectureHours: "0", tutorialHours: "0", practicalHours: "0", credits: "", type: "THEORY",
});

export default function SubjectsPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [categories, setCategories] = useState<CategoryDefinition[]>(builtInCategories());
  const [courseId, setCourseId] = useState("");
  const [regulation, setRegulation] = useState("");
  const [search, setSearch] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deleting, setDeleting] = useState<Subject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [c, k] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: CourseOption[] }>),
          fetch("/api/college/subject-categories").then((r) => r.json() as Promise<{ categories?: CategoryDefinition[] }>),
        ]);
        const active = (c.courses ?? []).filter((x) => x.isActive !== false);
        setCourses(active);
        if (active[0]) setCourseId(active[0].id);
        setCategories([...builtInCategories(), ...(k.categories ?? [])]);
      } catch {
        setLoadError("Couldn't load courses.");
      }
    })();
  }, []);

  async function load(id = courseId) {
    if (!id) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/subjects?courseId=${encodeURIComponent(id)}`);
      const json = await res.json() as { subjects?: Subject[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setSubjects(json.subjects ?? []);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load subjects.");
    } finally {
      setIsLoading(false);
    }
  }
  useEffect(() => {
    void load(courseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const regulations = useMemo(() => Array.from(new Set(subjects.map((s) => s.regulation).filter((r): r is string => !!r))).sort(), [subjects]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subjects
      .filter((s) => !regulation || s.regulation === regulation)
      .filter((s) => !q || `${s.name} ${s.code} ${s.shortCode ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.regulation ?? "").localeCompare(b.regulation ?? "") || (a.serialNumber ?? 1e9) - (b.serialNumber ?? 1e9) || a.name.localeCompare(b.name));
  }, [subjects, regulation, search]);

  function openEdit(s: Subject) {
    setFormError("");
    setForm({
      id: s.id, courseId: s.courseId ?? courseId, regulation: s.regulation ?? "",
      serialNumber: String(s.serialNumber ?? ""), category: String(s.category ?? ""), name: s.name, code: s.code,
      shortCode: s.shortCode ?? "", lectureHours: String(s.lectureHours ?? 0), tutorialHours: String(s.tutorialHours ?? 0),
      practicalHours: String(s.practicalHours ?? 0), credits: String(s.credits ?? ""), type: s.type ?? "THEORY",
    });
  }

  async function handleSave() {
    if (!form) return;
    const f = form;
    if (!f.name.trim() || !f.code.trim() || !f.category) { setFormError("Name, code and category are required."); return; }
    const body = {
      name: f.name, code: f.code, shortCode: f.shortCode, category: f.category, type: f.type,
      serialNumber: Number(f.serialNumber) || 0,
      lectureHours: Number(f.lectureHours) || 0, tutorialHours: Number(f.tutorialHours) || 0, practicalHours: Number(f.practicalHours) || 0,
      credits: f.credits === "" ? 0 : Number(f.credits),
      hoursPerWeek: (Number(f.lectureHours) || 0) + (Number(f.tutorialHours) || 0) + (Number(f.practicalHours) || 0),
      ...(f.id ? {} : { courseId: f.courseId, regulation: f.regulation.trim() || undefined }),
    };
    setIsSaving(true);
    setFormError("");
    try {
      const res = await fetch(f.id ? `/api/college/subjects/${f.id}` : "/api/college/subjects", {
        method: f.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setFormError(json.error ?? "Couldn't save."); return; }
      toast({ variant: "success", title: f.id ? "Subject updated" : "Subject added" });
      setForm(null);
      await load();
    } catch {
      setFormError("Network error. Nothing was saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/subjects/${deleting.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Couldn't delete the subject" }); return; }
      toast({ variant: "success", title: `${deleting.code} deleted` });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Network error. Nothing was deleted." });
    } finally {
      setIsDeleting(false);
      setDeleting(null);
    }
  }

  async function toggleActive(s: Subject) {
    const res = await fetch(`/api/college/subjects/${s.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: s.isActive === false }),
    });
    if (!res.ok) { toast({ variant: "destructive", title: "Couldn't update the subject" }); return; }
    await load();
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="View and manage the master subjects for each course and regulation."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
            </Button>
            <Button disabled={!courseId} onClick={() => { setFormError(""); setForm(emptyForm(courseId, regulation)); }}>
              <Plus className="h-4 w-4 mr-1" />Add subject
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="subj-course">Course</Label>
            <select id="subj-course" className={SELECT_CLASS} value={courseId} onChange={(e) => { setCourseId(e.target.value); setRegulation(""); }}>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subj-reg">Regulation</Label>
            <select id="subj-reg" className={SELECT_CLASS} value={regulation} onChange={(e) => setRegulation(e.target.value)}>
              <option value="">All</option>
              {regulations.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subj-search">Search</Label>
            <Input id="subj-search" placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loadError && <p className="px-6 py-3 text-sm text-red-600">{loadError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">S.No</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Reg.</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">L-T-P</th>
                  <th className="px-3 py-2 font-medium">Credits</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className={`border-b ${s.isActive === false ? "text-muted-foreground" : ""}`}>
                    <td className="px-4 py-2">{s.serialNumber ?? "-"}</td>
                    <td className="px-3 py-2 font-mono">{s.code}</td>
                    <td className="px-3 py-2">{s.name}{s.isActive === false && <span className="ml-2 text-xs">(inactive)</span>}</td>
                    <td className="px-3 py-2">{s.regulation ?? "-"}</td>
                    <td className="px-3 py-2">{s.category ?? "-"}</td>
                    <td className="px-3 py-2">{s.lectureHours ?? 0}-{s.tutorialHours ?? 0}-{s.practicalHours ?? 0}</td>
                    <td className="px-3 py-2">{s.credits ?? 0}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggleActive(s)}>{s.isActive === false ? "Activate" : "Deactivate"}</Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeleting(s)}>Delete</Button>
                    </td>
                  </tr>
                ))}
                {!isLoading && rows.length === 0 && !loadError && (
                  <tr><td colSpan={8} className="px-6 py-4 text-muted-foreground">No subjects found for this selection.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{form?.id ? "Edit subject" : "Add subject"}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Code</Label><Input value={form.code} onChange={set("code")} /></div>
              <div className="space-y-1.5"><Label>Short code</Label><Input value={form.shortCode} onChange={set("shortCode")} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Name</Label><Input value={form.name} onChange={set("name")} /></div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <select className={SELECT_CLASS} value={form.category} onChange={set("category")}>
                  <option value="">Select…</option>
                  {categories.map((c) => <option key={c.code} value={c.code}>{c.code} - {c.fullForm}</option>)}
                  {form.category && !categories.some((c) => c.code === form.category) && <option value={form.category}>{form.category}</option>}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select className={SELECT_CLASS} value={form.type} onChange={set("type")}>
                  {(Object.keys(SUBJECT_TYPE_LABELS) as SubjectType[]).map((t) => <option key={t} value={t}>{SUBJECT_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Regulation{form.id ? " (fixed)" : ""}</Label><Input value={form.regulation} onChange={set("regulation")} disabled={!!form.id} placeholder="e.g. R23" /></div>
              <div className="space-y-1.5"><Label>S.No</Label><Input type="number" value={form.serialNumber} onChange={set("serialNumber")} /></div>
              <div className="space-y-1.5"><Label>L</Label><Input type="number" min={0} value={form.lectureHours} onChange={set("lectureHours")} /></div>
              <div className="space-y-1.5"><Label>T</Label><Input type="number" min={0} value={form.tutorialHours} onChange={set("tutorialHours")} /></div>
              <div className="space-y-1.5"><Label>P</Label><Input type="number" min={0} value={form.practicalHours} onChange={set("practicalHours")} /></div>
              <div className="space-y-1.5"><Label>Credits</Label><Input type="number" min={0} step="0.5" value={form.credits} onChange={set("credits")} /></div>
            </div>
          )}
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.code}?`}
        description={`${deleting?.name}. A subject that is still assigned to a semester or staffed can't be deleted - deactivate it instead.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
