"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { Pencil, Trash2 } from "lucide-react";
import type { Subject, SubjectType } from "@/types";

const PAGE_SIZE = 20;

interface EditForm {
  id: string;
  name: string; code: string; shortCode: string;
  category: string; customCategory: string;
  lectureHours: string; tutorialHours: string; practicalHours: string; credits: string;
  type: SubjectType;
}

function toEditForm(s: Subject): EditForm {
  return {
    id: s.id, name: s.name ?? "", code: s.code ?? "", shortCode: s.shortCode ?? "",
    category: s.category ?? "", customCategory: s.customCategory ?? "",
    lectureHours: String(s.lectureHours ?? 0), tutorialHours: String(s.tutorialHours ?? 0), practicalHours: String(s.practicalHours ?? 0),
    credits: String(s.credits ?? 0), type: s.type ?? "THEORY",
  };
}

// The master subject list for one Course + Regulation, paged client-side
// (a course's own subject count is small - dozens, not thousands - so a
// second paginated endpoint isn't worth it) with inline Edit/Delete reusing
// the existing single-subject PATCH/DELETE route.
//
// catalogId, when the course has one, scopes the GET to every sibling
// department's own Course doc for the same catalog entry (the GET route's
// own catalogId branch - see /api/college/subjects) - master subjects are
// shared/deduped across that whole group (CourseStructureImportService), so
// a subject imported under one department's courseId must still show up
// here regardless of which department's Course doc this table was opened
// from. Without it, this table silently scoped to a single courseId and
// could show "0 subjects" for a regulation that was imported, just under a
// sibling department's own copy of the course.
export function SubjectsMasterTable({ courseId, catalogId, courseName, regulation }: {
  courseId: string;
  catalogId?: string;
  courseName: string;
  regulation: string;
}) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/subjects/${editForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(), code: editForm.code.trim().toUpperCase(), shortCode: editForm.shortCode.trim() || undefined,
          category: editForm.category || undefined, customCategory: editForm.category === "OTHER" ? editForm.customCategory.trim() : undefined,
          lectureHours: Number(editForm.lectureHours) || 0, tutorialHours: Number(editForm.tutorialHours) || 0, practicalHours: Number(editForm.practicalHours) || 0,
          credits: Number(editForm.credits) || 0, type: editForm.type,
        }),
      });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; toast({ variant: "destructive", title: j.error ?? "Failed to save" }); return; }
      toast({ variant: "success", title: "Subject updated" });
      setEditForm(null);
      await load();
    } finally {
      setIsSaving(false);
    }
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
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-md border bg-muted/30 animate-pulse" />)}</div>
        ) : subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No subjects imported yet for this course and regulation.</p>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditForm(toEditForm(s))}><Pencil className="h-3.5 w-3.5" /></Button>
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
              <div className="space-y-1"><Label>Category</Label><Input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} /></div>
              <div className="space-y-1"><Label>Name</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Code</Label><Input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} /></div>
                <div className="space-y-1"><Label>Short Code</Label><Input value={editForm.shortCode} onChange={(e) => setEditForm({ ...editForm, shortCode: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1"><Label>L</Label><Input value={editForm.lectureHours} onChange={(e) => setEditForm({ ...editForm, lectureHours: e.target.value })} /></div>
                <div className="space-y-1"><Label>T</Label><Input value={editForm.tutorialHours} onChange={(e) => setEditForm({ ...editForm, tutorialHours: e.target.value })} /></div>
                <div className="space-y-1"><Label>P</Label><Input value={editForm.practicalHours} onChange={(e) => setEditForm({ ...editForm, practicalHours: e.target.value })} /></div>
                <div className="space-y-1"><Label>Credits</Label><Input value={editForm.credits} onChange={(e) => setEditForm({ ...editForm, credits: e.target.value })} /></div>
              </div>
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
        description={`"${deleting?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </Card>
  );
}
