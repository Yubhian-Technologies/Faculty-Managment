"use client";

import { fetchDepartments } from "@/lib/client/departmentsFetch";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { Download, FileText, Pencil, Search, Trash2, Upload, X } from "lucide-react";
import { SUBJECT_TYPE_LABELS } from "@/types";
import type { Subject, SubjectCategory, SubjectType } from "@/types";
import { CategoryField } from "@/components/academics/CategoryField";
import { downloadCSV, toCSV } from "@/lib/utils/csv";
import { ownerDepartmentNames } from "@/lib/subjects/ownerDepartment";

const PAGE_SIZE = 20;
const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

interface EditForm {
  id: string;
  name: string; code: string; shortCode: string; altShortCode: string; totalHoursPerSemester: string;
  excludeFromTeachingLoad: boolean;
  category: SubjectCategory | ""; customCategory: string;
  lectureHours: string; tutorialHours: string; practicalHours: string; credits: string;
  type: SubjectType;
}

function toEditForm(s: Subject): EditForm {
  return {
    id: s.id, name: s.name ?? "", code: s.code ?? "", shortCode: s.shortCode ?? "", altShortCode: s.altShortCode ?? "",
    totalHoursPerSemester: s.totalHoursPerSemester != null ? String(s.totalHoursPerSemester) : "", excludeFromTeachingLoad: s.isNonTeachingLoad === true,
    category: s.category ?? "", customCategory: s.customCategory ?? "",
    lectureHours: String(s.lectureHours ?? 0), tutorialHours: String(s.tutorialHours ?? 0), practicalHours: String(s.practicalHours ?? 0),
    credits: String(s.credits ?? 0), type: s.type ?? "THEORY",
  };
}

// The master subject list for one Course (catalog) + Regulation, paged client-side
// (a course's own subject count is small - dozens, not thousands - so a
// second paginated endpoint isn't worth it) with inline Edit/Delete reusing
// the single-subject PATCH/DELETE route. Code and Name can't be edited once a subject
// is assigned to a semester (the server says so); everything else can.
export function SubjectsMasterTable({ courseId, catalogId, courseName, regulation }: {
  courseId: string;
  /** When the course has a catalog entry, list the subjects of EVERY department's copy of it. */
  catalogId?: string;
  courseName: string;
  regulation: string;
}) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleting, setDeleting] = useState<Subject | null>(null);
  // Renaming an assigned subject: preview of what changes, then a job that updates every copy (with progress).
  const [renamePreview, setRenamePreview] = useState<{ counts: { key: string; label: string; count: number | null }[] } | null>(null);
  const [renaming, setRenaming] = useState<{ step: string; done: number; total: number } | null>(null);
  // Subject Department: tick subjects, pick a department, Set (Academics / Principal / VP).
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"SET" | "ADD" | "REMOVE">("SET");
  const [bulkDept, setBulkDept] = useState("");
  const [bulkDept2, setBulkDept2] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [syllabusBusy, setSyllabusBusy] = useState("");

  useEffect(() => {
    fetchDepartments()
      .then((r) => r.json() as Promise<{ departments?: { id: string; name?: string }[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((x) => x.name?.trim()).map((x) => ({ id: x.id, name: x.name!.trim() })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setDepartments([]));
  }, []);
  const deptName = (s: Subject) => ownerDepartmentNames(s, new Map(departments.map((d) => [d.id, d.name]))).join(", ");

  async function setOwnerDepartment() {
    if (selected.size === 0 || !bulkDept) return;
    const none = bulkMode === "SET" && bulkDept === "NONE";
    const departmentIds = none ? [] : [...new Set([bulkDept, ...(bulkMode === "SET" && bulkDept2 ? [bulkDept2] : [])])];
    setBulkBusy(true);
    try {
      const res = await fetch("/api/college/subjects/owner-department", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectIds: [...selected], mode: bulkMode, departmentIds }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; updated?: number };
      if (!res.ok) { toast({ variant: "destructive", title: j.error ?? "Unable to change the Subject Department" }); return; }
      const did = none ? "cleared" : bulkMode === "ADD" ? "added" : bulkMode === "REMOVE" ? "removed" : "set";
      toast({ variant: "success", title: `Subject Department ${did} for ${j.updated ?? 0} subject${j.updated === 1 ? "" : "s"}` });
      setSelected(new Set());
      setBulkDept("");
      setBulkDept2("");
      await load();
    } finally { setBulkBusy(false); }
  }

  async function uploadSyllabus(s: Subject, file: File) {
    setSyllabusBusy(s.id);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/college/subjects/${s.id}/syllabus`, { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: j.error ?? "Upload failed" }); return; }
      toast({ variant: "success", title: `Syllabus saved for ${s.code}` });
      await load();
    } finally { setSyllabusBusy(""); }
  }

  async function removeSyllabus(s: Subject) {
    setSyllabusBusy(s.id);
    try {
      const res = await fetch(`/api/college/subjects/${s.id}/syllabus`, { method: "DELETE" });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; toast({ variant: "destructive", title: j.error ?? "Unable to remove it" }); return; }
      toast({ variant: "success", title: `Syllabus removed from ${s.code}` });
      await load();
    } finally { setSyllabusBusy(""); }
  }

  async function load() {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({ ...(catalogId ? { catalogId } : { courseId }), ...(regulation ? { regulation } : {}) });
      const res = await fetch(`/api/college/subjects?${qs}`);
      const json = (await res.json()) as { subjects?: Subject[] };
      setSubjects(json.subjects ?? []);
      setPage(0);
    } catch {
      toast({ variant: "destructive", title: "Unable to load subjects" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [courseId, catalogId, regulation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search by Category, Subject Code or Subject Name (case-insensitive substring) over the already-loaded list.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter((s) => {
      const category = s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? "");
      return [category, s.category ?? "", s.code, s.name].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [subjects, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [filtered, page]);

  /** Name / code changed: show what a rename would update before doing it. */
  const original = editForm ? subjects.find((x) => x.id === editForm.id) : undefined;
  const identityChanged = !!(editForm && original && (editForm.name.trim() !== original.name || editForm.code.trim().toUpperCase() !== String(original.code).toUpperCase()));

  async function previewRename() {
    if (!editForm) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/subjects/${editForm.id}/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editForm.name, code: editForm.code, preview: true }) });
      const j = (await res.json()) as { counts?: { key: string; label: string; count: number | null }[]; error?: string };
      if (!res.ok || !j.counts) { setEditError(j.error ?? "Unable to check the rename"); return; }
      setRenamePreview({ counts: j.counts });
    } finally { setIsSaving(false); }
  }

  async function runRename() {
    if (!editForm) return;
    setRenamePreview(null);
    setRenaming({ step: "Renaming the subject", done: 0, total: 1 });
    try {
      const res = await fetch(`/api/college/subjects/${editForm.id}/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editForm.name, code: editForm.code }) });
      const j = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !j.jobId) throw new Error(j.error ?? "Unable to rename");
      // Work through the job until every copy is updated (each call does a part; safe to repeat).
      for (let i = 0; i < 500; i++) {
        const r = await fetch(`/api/college/subjects/rename-jobs/${j.jobId}`, { method: "POST" });
        const jj = (await r.json()) as { job?: { status: string; progress: { step: string; done: number; total: number } }; error?: string };
        if (!r.ok || !jj.job) throw new Error(jj.error ?? "The rename stopped - open the subject again to continue");
        setRenaming(jj.job.progress);
        if (jj.job.status === "DONE") break;
      }
      toast({ variant: "success", title: "Subject renamed everywhere" });
      await handleSave(true);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Unable to rename");
    } finally { setRenaming(null); }
  }

  async function handleSave(afterRename = false) {
    if (!editForm) return;
    if (!editForm.name.trim() || !editForm.code.trim()) { toast({ variant: "destructive", title: "Name and code are required" }); return; }
    if (!editForm.category) { toast({ variant: "destructive", title: "Category is required" }); return; }
    if (identityChanged && !afterRename) { await previewRename(); return; }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/subjects/${editForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Numbers go as typed: the server rejects an unreadable value instead of turning it into 0.
        body: JSON.stringify({
          name: editForm.name, code: editForm.code, shortCode: editForm.shortCode, altShortCode: editForm.altShortCode,
          totalHoursPerSemester: editForm.totalHoursPerSemester, excludeFromTeachingLoad: editForm.excludeFromTeachingLoad,
          category: editForm.category, customCategory: editForm.category === "OTHER" ? editForm.customCategory : "",
          lectureHours: editForm.lectureHours, tutorialHours: editForm.tutorialHours, practicalHours: editForm.practicalHours,
          credits: editForm.credits, type: editForm.type,
        }),
      });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setEditError(j.error ?? "Unable to save"); return; }
      toast({ variant: "success", title: "Subject updated" });
      setEditForm(null);
      await load();
    } finally {
      setIsSaving(false);
    }
  }

  function handleExport() {
    const header = [
      "Category", "Name", "Code", "Short Code", "Second Short Code", "Type",
      "Lecture Hours", "Tutorial Hours", "Practical Hours", "Credits", "Total Hours per Semester", "Regulation", "Subject Department",
    ];
    const rows = subjects.map((s) => [
      s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? ""),
      s.name ?? "", s.code ?? "", s.shortCode ?? "", s.altShortCode ?? "", s.type ?? "",
      String(s.lectureHours ?? 0), String(s.tutorialHours ?? 0), String(s.practicalHours ?? 0), String(s.credits ?? 0),
      s.totalHoursPerSemester != null ? String(s.totalHoursPerSemester) : "",
      s.regulation ?? "", deptName(s),
    ]);
    const safeName = [courseName, regulation].filter(Boolean).join("_").replace(/[^a-z0-9]+/gi, "_");
    downloadCSV(toCSV([header, ...rows]), `subjects_${safeName}.csv`);
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; toast({ variant: "destructive", title: j.error ?? "Unable to delete" }); return; }
      toast({ variant: "success", title: "Subject deleted" });
      await load();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{courseName}{regulation ? ` · ${regulation}` : ""} - {subjects.length} subject{subjects.length !== 1 ? "s" : ""}</h3>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={subjects.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" />Export
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by category, subject code or name"
            aria-label="Search subjects by category, code or name"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size ? `${selected.size} selected` : "Subject Department"}</span>
          <span className="text-xs text-muted-foreground">{selected.size ? "" : "Tick subjects to set which department(s) look after them - up to two. Their HODs keep the syllabus and approve the question banks / papers (either one decides). Not set = each branch's own HOD."}</span>
          {selected.size > 0 && (
            <>
              <select aria-label="Change" className="h-8 rounded-md border bg-background px-2 text-sm" value={bulkMode} onChange={(e) => { setBulkMode(e.target.value as "SET" | "ADD" | "REMOVE"); setBulkDept(""); setBulkDept2(""); }}>
                <option value="SET">Set to</option>
                <option value="ADD">Add</option>
                <option value="REMOVE">Remove</option>
              </select>
              <select aria-label="Subject Department" className="h-8 min-w-48 rounded-md border bg-background px-2 text-sm" value={bulkDept} onChange={(e) => setBulkDept(e.target.value)}>
                <option value="">Pick a department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                {bulkMode === "SET" && <option value="NONE">None - each branch looks after it</option>}
              </select>
              {bulkMode === "SET" && bulkDept && bulkDept !== "NONE" && (
                <select aria-label="Second Subject Department (optional)" className="h-8 min-w-48 rounded-md border bg-background px-2 text-sm" value={bulkDept2} onChange={(e) => setBulkDept2(e.target.value)}>
                  <option value="">and no second department</option>
                  {departments.filter((d) => d.id !== bulkDept).map((d) => <option key={d.id} value={d.id}>and {d.name}</option>)}
                </select>
              )}
              <Button size="sm" onClick={() => void setOwnerDepartment()} loading={bulkBusy} disabled={!bulkDept}>{bulkMode === "SET" ? "Set" : bulkMode === "ADD" ? "Add" : "Remove"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="mr-1 h-3.5 w-3.5" />Clear selection</Button>
            </>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-md border bg-muted/30 animate-pulse" />)}</div>
        ) : subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No subjects yet for this course and regulation. Import a file or add a subject.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No subjects match &ldquo;{search.trim()}&rdquo;.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-2">
                      <Checkbox aria-label="Select every subject on this page" checked={pageRows.length > 0 && pageRows.every((s) => selected.has(s.id))}
                        onCheckedChange={(v) => setSelected((cur) => { const next = new Set(cur); for (const s of pageRows) { if (v === true) next.add(s.id); else next.delete(s.id); } return next; })} />
                    </th>
                    <th className="py-1.5 pr-3">Category</th>
                    <th className="py-1.5 pr-3">Name</th>
                    <th className="py-1.5 pr-3">Code</th>
                    <th className="py-1.5 pr-3">L-T-P</th>
                    <th className="py-1.5 pr-3">Credits</th>
                    <th className="py-1.5 pr-3">Regulation</th>
                    <th className="py-1.5 pr-3">Subject Department</th>
                    <th className="py-1.5 pr-3">Syllabus</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRows.map((s) => (
                    <tr key={s.id}>
                      <td className="py-1.5 pr-2">
                        <Checkbox aria-label={`Select ${s.code}`} checked={selected.has(s.id)}
                          onCheckedChange={(v) => setSelected((cur) => { const next = new Set(cur); if (v === true) next.add(s.id); else next.delete(s.id); return next; })} />
                      </td>
                      <td className="py-1.5 pr-3">{s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? "-")}</td>
                      <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                      <td className="py-1.5 pr-3 font-mono">{s.code}</td>
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{s.lectureHours}-{s.tutorialHours}-{s.practicalHours}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{s.credits}</td>
                      <td className="py-1.5 pr-3">{s.regulation ?? "-"}</td>
                      <td className="py-1.5 pr-3">{deptName(s) || <span className="text-xs text-muted-foreground">Each branch</span>}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {s.syllabusUrl && (
                          <>
                            <a href={s.syllabusUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline" title={s.syllabusFileName ?? undefined}><FileText className="h-3.5 w-3.5" />View</a>
                            <Button variant="ghost" size="icon" className="ml-1 h-7 w-7 text-destructive" aria-label={`Remove the syllabus of ${s.code}`} disabled={syllabusBusy === s.id} onClick={() => void removeSyllabus(s)}><X className="h-3.5 w-3.5" /></Button>
                          </>
                        )}
                        <label className={`inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${syllabusBusy === s.id ? "pointer-events-none opacity-50" : ""}`}>
                          <Upload className="h-3.5 w-3.5" />{syllabusBusy === s.id ? "Saving..." : s.syllabusUrl ? "Replace" : "Upload PDF"}
                          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadSyllabus(s, f); }} />
                        </label>
                      </td>
                      <td className="py-1.5 whitespace-nowrap">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditError(""); setEditForm(toEditForm(s)); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleting(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={!!editForm} onOpenChange={(o) => !o && setEditForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Subject</DialogTitle></DialogHeader>
          {editForm && (
            <div className="space-y-3">
              <CategoryField
                category={editForm.category}
                customCategory={editForm.customCategory}
                onCategoryChange={(c) => setEditForm({ ...editForm, category: c })}
                onCustomCategoryChange={(v) => setEditForm({ ...editForm, customCategory: v })}
                allowNew={false}
              />
              <div className="space-y-1"><Label>Name</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Code</Label><Input className="font-mono uppercase" value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Short Code</Label><Input className="uppercase" value={editForm.shortCode} onChange={(e) => setEditForm({ ...editForm, shortCode: e.target.value })} /></div>
                <div className="space-y-1"><Label>Second Short Code</Label><Input className="uppercase" placeholder="Asked when placing in the timetable" value={editForm.altShortCode} onChange={(e) => setEditForm({ ...editForm, altShortCode: e.target.value })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">Changing the code or name updates every record that uses this subject (timetables, attendance, marks, results and others). The changes are shown before they are applied. The old code still matches results files.</p>
              <div className="space-y-1">
                <Label>Type</Label>
                <select className={SELECT_CLASS} value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value as SubjectType })}>
                  {Object.entries(SUBJECT_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1"><Label>L</Label><Input value={editForm.lectureHours} onChange={(e) => setEditForm({ ...editForm, lectureHours: e.target.value })} /></div>
                <div className="space-y-1"><Label>T</Label><Input value={editForm.tutorialHours} onChange={(e) => setEditForm({ ...editForm, tutorialHours: e.target.value })} /></div>
                <div className="space-y-1"><Label>P</Label><Input value={editForm.practicalHours} onChange={(e) => setEditForm({ ...editForm, practicalHours: e.target.value })} /></div>
                <div className="space-y-1"><Label>Credits</Label><Input value={editForm.credits} onChange={(e) => setEditForm({ ...editForm, credits: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Total Hours per Semester</Label><Input inputMode="decimal" placeholder="Optional" value={editForm.totalHoursPerSemester} onChange={(e) => setEditForm({ ...editForm, totalHoursPerSemester: e.target.value })} /></div>
                <label className="flex items-end gap-2 pb-2 text-sm"><Checkbox checked={editForm.excludeFromTeachingLoad} onCheckedChange={(v) => setEditForm({ ...editForm, excludeFromTeachingLoad: v === true })} />Not in teaching load</label>
              </div>
              <p className="text-xs text-muted-foreground">Hours and credits here are the course-wide values; a department&apos;s own values are set on the Assign tab.</p>
              {editError && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-destructive/20 dark:bg-destructive/10 dark:text-red-400">{editError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditForm(null)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving || !!renaming}>{identityChanged ? "Rename & save" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renamePreview || !!renaming} onOpenChange={(o) => { if (!o && !renaming) setRenamePreview(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{renaming ? "Renaming..." : "Rename this subject everywhere?"}</DialogTitle></DialogHeader>
          {renamePreview && editForm && original && (
            <div className="space-y-3 text-sm">
              <p><span className="font-mono">{original.code}</span> {original.name} <b>-&gt;</b> <span className="font-mono">{editForm.code.trim().toUpperCase()}</span> {editForm.name.trim()}</p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border p-2 text-xs">
                {renamePreview.counts.map((c) => (
                  <li key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span className="tabular-nums text-muted-foreground">{c.count === null ? "checked while updating" : c.count}</span></li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Past attendance and published results also show the new name. Issued certificates and printed question papers are not changed. The old code still matches results files.</p>
            </div>
          )}
          {renaming && (
            <div className="space-y-2 text-sm">
              <p>{renaming.step}</p>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((renaming.done / Math.max(1, renaming.total)) * 100)}%` }} /></div>
              <p className="text-xs text-muted-foreground">Keep this page open until the process finishes.</p>
            </div>
          )}
          {!renaming && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenamePreview(null)}>Cancel</Button>
              <Button onClick={() => void runRename()}>Rename everywhere</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete subject?"
        description={`"${deleting?.name}" will be permanently removed. This is only possible while it isn't assigned to any semester.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </Card>
  );
}
