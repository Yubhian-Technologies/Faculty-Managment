"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { ArrowLeft, Edit2, Trash2 } from "lucide-react";
import type { Subject } from "@/types";

// Academics > Subjects. View and manage subjects assigned to departments
// by year and semester. Filter all at once, CRUD on cards.

type CourseOption = { id: string; name: string; isActive?: boolean };
type DepartmentOption = { id: string; name: string };
type AssignmentWithMaster = { assignment: any; master: Subject };
type EditForm = {
  assignmentId?: string;
  lectureHours: string;
  tutorialHours: string;
  practicalHours: string;
  credits: string;
};

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export default function SubjectsPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [courseId, setCourseId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [year, setYear] = useState("1");
  const [semester, setSemester] = useState("1");
  const [assignments, setAssignments] = useState<AssignmentWithMaster[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [c, d] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: CourseOption[] }>),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: DepartmentOption[] }>),
        ]);
        const courses = (c.courses ?? []).filter((x) => x.isActive !== false);
        const depts = (d.departments ?? []).filter((x: any) => !x.parentDepartmentId);
        setCourses(courses);
        setDepartments(depts);
        if (courses[0]) setCourseId(courses[0].id);
        if (depts[0]) setDeptId(depts[0].id);
      } catch {
        setLoadError("Couldn't load courses or departments.");
      }
    })();
  }, []);

  async function handleLoad() {
    if (!courseId || !deptId) { setLoadError("Please select course and department."); return; }
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await fetch(
        `/api/college/subject-semester-assignments?courseId=${encodeURIComponent(courseId)}&departmentId=${encodeURIComponent(deptId)}&year=${year}&semester=${semester}`
      );
      const json = await res.json() as { assignments?: any[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");

      const subjectIds = new Set((json.assignments ?? []).map((a) => a.subjectId));
      const masters = new Map<string, Subject>();

      if (subjectIds.size > 0) {
        const masterRes = await fetch(`/api/college/subjects?${Array.from(subjectIds).map(id => `subjectIds=${id}`).join("&")}`);
        const masterJson = await masterRes.json() as { subjects?: Subject[] };
        (masterJson.subjects ?? []).forEach(s => masters.set(s.id, s));
      }

      setAssignments((json.assignments ?? []).map((a) => ({
        assignment: a,
        master: masters.get(a.subjectId) || { id: a.subjectId, code: a.subjectCode, name: a.subjectName } as Subject,
      })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load subjects.");
    } finally {
      setIsLoading(false);
    }
  }

  function openEdit(item: AssignmentWithMaster) {
    setEditError("");
    setEditForm({
      assignmentId: item.assignment.id,
      lectureHours: String(item.assignment.lectureHours ?? item.master.lectureHours ?? 0),
      tutorialHours: String(item.assignment.tutorialHours ?? item.master.tutorialHours ?? 0),
      practicalHours: String(item.assignment.practicalHours ?? item.master.practicalHours ?? 0),
      credits: String(item.assignment.credits ?? item.master.credits ?? 0),
    });
  }

  async function handleSave() {
    if (!editForm?.assignmentId) return;
    setIsSaving(true);
    setEditError("");
    try {
      const res = await fetch(`/api/college/subject-semester-assignments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editForm.assignmentId,
          lectureHours: Number(editForm.lectureHours) || 0,
          tutorialHours: Number(editForm.tutorialHours) || 0,
          practicalHours: Number(editForm.practicalHours) || 0,
          credits: Number(editForm.credits) || 0,
        }),
      });
      if (!res.ok) { const json = await res.json() as { error?: string }; setEditError(json.error ?? "Failed to save."); return; }
      toast({ variant: "success", title: "Subject updated" });
      setEditForm(null);
      await handleLoad();
    } catch {
      setEditError("Network error. Nothing was saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/college/subject-semester-assignments?subjectId=${encodeURIComponent(deleting.subjectId)}&departmentId=${encodeURIComponent(deptId)}&semester=${deleting.semester}`,
        { method: "DELETE" }
      );
      if (!res.ok) { const json = await res.json() as { error?: string }; toast({ variant: "destructive", title: json.error ?? "Couldn't delete" }); return; }
      toast({ variant: "success", title: "Subject removed" });
      await handleLoad();
    } catch {
      toast({ variant: "destructive", title: "Network error." });
    } finally {
      setIsDeleting(false);
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="View and manage subjects by department, year and semester"
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="course">Course</Label>
            <select id="course" className={SELECT_CLASS} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Select…</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dept">Department</Label>
            <select id="dept" className={SELECT_CLASS} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">Select…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yr">Year</Label>
            <select id="yr" className={SELECT_CLASS} value={year} onChange={(e) => setYear(e.target.value)}>
              {[1, 2, 3, 4].map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sem">Semester</Label>
            <select id="sem" className={SELECT_CLASS} value={semester} onChange={(e) => setSemester(e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={String(s)}>Sem {s}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={() => void handleLoad()} className="w-full" disabled={!courseId || !deptId}>
              Load
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Subjects Grid */}
      {loadError && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">{loadError}</div>}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Select filters and click Load to view subjects.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((item) => (
            <Card key={item.assignment.id} className="flex flex-col">
              <CardContent className="flex flex-col flex-1 p-4 space-y-3">
                {/* Header */}
                <div>
                  <div className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded bg-muted text-xs font-mono font-semibold text-muted-foreground mb-1">
                    {item.master.code}
                  </div>
                  <p className="font-semibold text-sm">{item.master.name}</p>
                  {item.master.shortCode && <p className="text-xs text-muted-foreground">{item.master.shortCode}</p>}
                </div>

                {/* L-T-P */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Lecture</p>
                    <p className="font-semibold">{item.assignment.lectureHours ?? item.master.lectureHours ?? 0}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Tutorial</p>
                    <p className="font-semibold">{item.assignment.tutorialHours ?? item.master.tutorialHours ?? 0}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Practical</p>
                    <p className="font-semibold">{item.assignment.practicalHours ?? item.master.practicalHours ?? 0}</p>
                  </div>
                </div>

                {/* Credits & Category */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Credits</p>
                    <p className="font-semibold">{item.assignment.credits ?? item.master.credits ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Category</p>
                    <p className="font-semibold">{item.master.category ?? "—"}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(item)}>
                    <Edit2 className="h-3.5 w-3.5 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeleting(item.assignment)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editForm} onOpenChange={(open) => !open && setEditForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Subject Hours</DialogTitle></DialogHeader>
          {editForm && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label>Lecture Hours</Label>
                <Input type="number" min={0} value={editForm.lectureHours} onChange={(e) => setEditForm({ ...editForm, lectureHours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tutorial Hours</Label>
                <Input type="number" min={0} value={editForm.tutorialHours} onChange={(e) => setEditForm({ ...editForm, tutorialHours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Practical Hours</Label>
                <Input type="number" min={0} value={editForm.practicalHours} onChange={(e) => setEditForm({ ...editForm, practicalHours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Credits</Label>
                <Input type="number" min={0} step="0.5" value={editForm.credits} onChange={(e) => setEditForm({ ...editForm, credits: e.target.value })} />
              </div>
            </div>
          )}
          {editError && <p className="text-sm text-red-600">{editError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditForm(null)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.subjectCode}?`}
        description="This will remove it from the department's curriculum for this semester."
        confirmLabel="Remove"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
