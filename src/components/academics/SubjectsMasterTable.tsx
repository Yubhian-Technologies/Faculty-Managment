"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { Download, Pencil, Trash2 } from "lucide-react";
import type { Subject, SubjectCategory, SubjectType } from "@/types";
import { CategoryField } from "@/components/academics/CategoryField";
import { downloadCSV, toCSV } from "@/lib/utils/csv";

const PAGE_SIZE = 20;

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
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleting, setDeleting] = useState<Subject | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({ ...(catalogId ? { catalogId } : { courseId }), ...(regulation ? { regulation } : {}) });
      const res = await fetch(`/api/college/subjects?${qs}`);
      const json = (await res.json()) as { subjects?: Subject[] };
      setSubjects(json.subjects ?? []);
      setPage(0);
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [courseId, catalogId, regulation]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = Math.max(1, Math.ceil(subjects.length / PAGE_SIZE));
  const pageRows = useMemo(() => subjects.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [subjects, page]);

  async function handleSave() {
    if (!editForm) return;
    if (!editForm.name.trim() || !editForm.code.trim()) { toast({ variant: "destructive", title: "Name and code are required" }); return; }
    if (!editForm.category) { toast({ variant: "destructive", title: "Category is required" }); return; }
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
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setEditError(j.error ?? "Failed to save"); return; }
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
      "Lecture Hours", "Tutorial Hours", "Practical Hours", "Credits", "Total Hours per Semester", "Regulation",
    ];
    const rows = subjects.map((s) => [
      s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? ""),
      s.name ?? "", s.code ?? "", s.shortCode ?? "", s.altShortCode ?? "", s.type ?? "",
      String(s.lectureHours ?? 0), String(s.tutorialHours ?? 0), String(s.practicalHours ?? 0), String(s.credits ?? 0),
      s.totalHoursPerSemester != null ? String(s.totalHoursPerSemester) : "",
      s.regulation ?? "",
    ]);
    const safeName = [courseName, regulation].filter(Boolean).join("_").replace(/[^a-z0-9]+/gi, "_");
    downloadCSV(toCSV([header, ...rows]), `subjects_${safeName}.csv`);
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; toast({ variant: "destructive", title: j.error ?? "Failed to delete" }); return; }
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

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-md border bg-muted/30 animate-pulse" />)}</div>
        ) : subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No subjects yet for this course and regulation. Import a file or add one.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3">Category</th>
                    <th className="py-1.5 pr-3">Name</th>
                    <th className="py-1.5 pr-3">Code</th>
                    <th className="py-1.5 pr-3">L-T-P</th>
                    <th className="py-1.5 pr-3">Credits</th>
                    <th className="py-1.5 pr-3">Regulation</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRows.map((s) => (
                    <tr key={s.id}>
                      <td className="py-1.5 pr-3">{s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? "-")}</td>
                      <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                      <td className="py-1.5 pr-3 font-mono">{s.code}</td>
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{s.lectureHours}-{s.tutorialHours}-{s.practicalHours}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{s.credits}</td>
                      <td className="py-1.5 pr-3">{s.regulation ?? "-"}</td>
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
              <p className="text-xs text-muted-foreground">Code and Name can&apos;t change once the subject is assigned to a semester - add a new subject with the new code instead.</p>
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
              <p className="text-xs text-muted-foreground">Hours and credits here are the course-wide values; a department&apos;s own override is set on the Assign tab.</p>
              {editError && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-destructive/20 dark:bg-destructive/10 dark:text-red-400">{editError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditForm(null)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving}>Save</Button>
          </DialogFooter>
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
