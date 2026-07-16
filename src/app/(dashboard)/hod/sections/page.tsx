"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Users, Pencil, Trash2, Plus, GraduationCap, UserCog, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { Section, Course } from "@/types";

type SectionRow = Section & { id: string };
type FacultyOption = { id: string; name: string; designation: string };

const YEAR_PALETTE = [
  "bg-purple-50 border-purple-200 text-purple-800",
  "bg-blue-50 border-blue-200 text-blue-800",
  "bg-emerald-50 border-emerald-200 text-emerald-800",
  "bg-amber-50 border-amber-200 text-amber-800",
  "bg-rose-50 border-rose-200 text-rose-800",
  "bg-cyan-50 border-cyan-200 text-cyan-800",
];
const YEAR_BADGE_PALETTE = [
  "bg-purple-100 text-purple-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];
function yearColor(year: number) { return YEAR_PALETTE[(year - 1) % YEAR_PALETTE.length]; }
function yearBadge(year: number) { return YEAR_BADGE_PALETTE[(year - 1) % YEAR_BADGE_PALETTE.length]; }
function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

const STUDENT_FACULTY_RATIO = 15;

type SectionForm = {
  courseId: string;
  name: string;
  year: string;
  batch: string;
  studentCount: number | "";
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

const EMPTY_FORM: SectionForm = {
  courseId: "",
  name: "",
  year: "",
  batch: "",
  studentCount: "",
  facultyInchargeUid: "",
  facultyInchargeName: "",
};

export default function HODSectionsPage() {
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCourseId, setActiveCourseId] = useState<string>("all");
  const [activeYear, setActiveYear] = useState<number | "all">("all");

  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SectionRow | null>(null);
  const [form, setForm] = useState<SectionForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SectionRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sectionsRes, coursesRes] = await Promise.all([
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: SectionRow[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      ]);
      setSections(sectionsRes.sections ?? []);
      setCourses((coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      toast({ variant: "destructive", title: "Failed to load sections" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Fetch faculty for incharge picker (once)
  useEffect(() => {
    fetch("/api/college/faculty?status=ACTIVE")
      .then((r) => r.json())
      .then((d: { faculty?: { id: string; name: string; designation: string }[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({ id: f.id, name: f.name, designation: f.designation })));
      })
      .catch(() => { /* non-critical */ });
  }, []);

  function setF(patch: Partial<SectionForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function openCreate() {
    setEditTarget(null);
    setForm(activeCourseId !== "all" ? { ...EMPTY_FORM, courseId: activeCourseId } : EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(s: SectionRow) {
    setEditTarget(s);
    setForm({
      courseId: s.courseId ?? "",
      name: s.name,
      year: String(s.year),
      batch: s.batch,
      studentCount: s.studentCount ?? "",
      facultyInchargeUid: s.facultyInchargeUid ?? "",
      facultyInchargeName: s.facultyInchargeName ?? "",
    });
    setDialogOpen(true);
  }

  function handleFacultySelect(facultyId: string) {
    if (!facultyId) {
      setF({ facultyInchargeUid: "", facultyInchargeName: "" });
      return;
    }
    const f = facultyList.find((x) => x.id === facultyId);
    setF({ facultyInchargeUid: facultyId, facultyInchargeName: f?.name ?? "" });
  }

  const formCourse = useMemo(() => courses.find((c) => c.id === form.courseId) ?? null, [courses, form.courseId]);
  const formYearOptions = useMemo(
    () => (formCourse ? Array.from({ length: formCourse.durationYears }, (_, i) => i + 1) : []),
    [formCourse]
  );

  async function handleSave() {
    if (!form.courseId) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Section name is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Year is required" }); return; }
    if (!form.batch.trim()) { toast({ variant: "destructive", title: "Batch is required (e.g. 2023-2027)" }); return; }

    setIsSaving(true);
    try {
      const payload = {
        courseId: form.courseId,
        name: form.name,
        year: Number(form.year),
        batch: form.batch,
        studentCount: form.studentCount === "" ? 0 : Number(form.studentCount),
        facultyInchargeUid: form.facultyInchargeUid || null,
        facultyInchargeName: form.facultyInchargeName,
      };

      const url = editTarget ? `/api/college/sections/${editTarget.id}` : "/api/college/sections";
      const method = editTarget ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }

      toast({ variant: "success", title: editTarget ? "Section updated" : "Section created" });
      setDialogOpen(false);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/sections/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to delete" });
        return;
      }
      toast({ variant: "success", title: `Section ${deleteTarget.name} deleted` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsDeleting(false);
    }
  }

  const activeCourse = activeCourseId !== "all" ? courses.find((c) => c.id === activeCourseId) ?? null : null;

  const filteredSections = sections.filter((s) => {
    if (activeCourseId !== "all" && s.courseId !== activeCourseId) return false;
    if (activeCourse && activeYear !== "all" && s.year !== activeYear) return false;
    return true;
  });

  // Group by course, then by year within each course
  type Group = { courseId: string; courseName: string; year: number; sections: SectionRow[] };
  const groups: Group[] = [];
  for (const s of filteredSections) {
    let g = groups.find((x) => x.courseId === s.courseId && x.year === s.year);
    if (!g) {
      g = { courseId: s.courseId, courseName: s.courseName ?? "Unknown Course", year: s.year, sections: [] };
      groups.push(g);
    }
    g.sections.push(s);
  }
  groups.sort((a, b) => a.courseName.localeCompare(b.courseName) || a.year - b.year);

  const totalStudents = sections.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections"
        description="Manage class sections, assign faculty incharge, and track student count"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/hod/students/import"><Upload className="h-4 w-4 mr-2" />Import Students</Link>
            </Button>
            <Button onClick={openCreate} disabled={courses.length === 0}>
              <Plus className="h-4 w-4 mr-2" />Add Section
            </Button>
          </div>
        }
      />

      {!isLoading && courses.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for your department yet. Ask the Principal to add courses under Departments before creating sections.
        </div>
      )}

      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <GraduationCap className="h-4 w-4" />
          <span><strong className="text-foreground">{sections.length}</strong> sections</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span><strong className="text-foreground">{totalStudents}</strong> students total</span>
        </div>
        {totalStudents > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <UserCog className="h-4 w-4" />
            <span>
              <strong className="text-foreground">{Math.ceil(totalStudents / STUDENT_FACULTY_RATIO)}</strong> faculty needed
              <span className="ml-1 text-xs">(1:{STUDENT_FACULTY_RATIO} ratio)</span>
            </span>
          </div>
        )}
      </div>

      {/* Course filter tabs */}
      {courses.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setActiveCourseId("all"); setActiveYear("all"); }}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              activeCourseId === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            All Courses
          </button>
          {courses.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveCourseId(c.id); setActiveYear("all"); }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeCourseId === c.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Year filter tabs (only when a specific course is selected) */}
      {activeCourse && (
        <div className="flex gap-2 flex-wrap">
          {(["all", ...Array.from({ length: activeCourse.durationYears }, (_, i) => i + 1)] as const).map((y) => (
            <button
              key={y}
              onClick={() => setActiveYear(y)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeYear === y
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {y === "all" ? "All Years" : ordinalYear(y)}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && courses.length > 0 && sections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GraduationCap className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">No sections yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create your first section to get started</p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Section</Button>
        </div>
      )}

      {/* Sections grouped by course + year */}
      {!isLoading && groups.length > 0 && (
        <div className="space-y-8">
          {groups.map((g) => {
            const sts = g.sections.reduce((s, r) => s + (r.studentCount ?? 0), 0);
            const req = sts > 0 ? Math.ceil(sts / STUDENT_FACULTY_RATIO) : 0;
            return (
              <div key={`${g.courseId}_${g.year}`}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="font-semibold text-base">
                    {activeCourseId === "all" ? `${g.courseName} · ${ordinalYear(g.year)}` : ordinalYear(g.year)}
                  </h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${yearBadge(g.year)}`}>
                    {g.sections.length} section{g.sections.length !== 1 ? "s" : ""} · {sts} students
                    {req > 0 && <span className="ml-1 opacity-75">· {req} faculty needed</span>}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.sections.map((sec) => (
                    <div
                      key={sec.id}
                      className={`rounded-xl border-2 p-5 flex flex-col gap-3 ${yearColor(sec.year)}`}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-2xl font-bold tracking-tight">Section {sec.name}</p>
                          <p className="text-sm opacity-70 mt-0.5">{sec.batch}</p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => openEdit(sec)}
                            className="p-1.5 rounded-md hover:bg-black/10 transition-colors"
                            title="Edit section"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(sec)}
                            className="p-1.5 rounded-md hover:bg-red-200/60 transition-colors text-red-700"
                            title="Delete section"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Faculty incharge */}
                      <div className="flex items-center gap-2">
                        <UserCog className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          {sec.facultyInchargeName
                            ? <strong>{sec.facultyInchargeName}</strong>
                            : <span className="opacity-50 italic">No incharge assigned</span>
                          }
                        </span>
                      </div>

                      {/* Student intake + faculty ratio */}
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          <strong>{sec.studentCount ?? 0}</strong> students
                        </span>
                      </div>
                      {(sec.studentCount ?? 0) > 0 && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <GraduationCap className="h-4 w-4 opacity-50 shrink-0" />
                          <span className="text-sm">
                            <strong>{Math.ceil((sec.studentCount ?? 0) / STUDENT_FACULTY_RATIO)}</strong> faculty needed
                            <span className="text-[11px] opacity-60 ml-1">(1:{STUDENT_FACULTY_RATIO})</span>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) setDialogOpen(false); }}>
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit Section ${editTarget.name}` : "Add New Section"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Course *</Label>
              <Select value={form.courseId} onValueChange={(v) => setF({ courseId: v, year: "" })}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Section Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setF({ name: e.target.value.toUpperCase() })}
                  placeholder="A, B, C…"
                  maxLength={5}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">e.g. A, B, C or CS-A</p>
              </div>
              <div className="space-y-1.5">
                <Label>Year *</Label>
                <Select value={form.year} onValueChange={(v) => setF({ year: v })} disabled={!formCourse}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {formYearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Batch *</Label>
              <Input
                value={form.batch}
                onChange={(e) => setF({ batch: e.target.value })}
                placeholder="e.g. 2023-2027"
              />
              <p className="text-xs text-muted-foreground">Admission year to passout year</p>
            </div>

            <div className="space-y-1.5">
              <Label>Student Intake</Label>
              <Input
                type="number"
                min={0}
                value={form.studentCount}
                onChange={(e) => setF({ studentCount: e.target.value === "" ? "" : Number(e.target.value) })}
                placeholder="e.g. 60"
              />
              {form.studentCount !== "" && Number(form.studentCount) > 0 && (
                <p className="text-xs text-blue-600 font-medium">
                  Faculty required (1:{STUDENT_FACULTY_RATIO} ratio): {Math.ceil(Number(form.studentCount) / STUDENT_FACULTY_RATIO)}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Faculty Incharge</Label>
              <Select
                value={form.facultyInchargeUid || "none"}
                onValueChange={(v) => handleFacultySelect(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select faculty incharge" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not assigned —</SelectItem>
                  {facultyList.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {facultyList.length === 0 && (
                <p className="text-xs text-muted-foreground">No active faculty found in your department.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving}>
              {editTarget ? "Save Changes" : "Create Section"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete Section ${deleteTarget?.name ?? ""}?`}
        description={
          (deleteTarget?.studentCount ?? 0) > 0
            ? `This section has ${deleteTarget?.studentCount} student(s). Remove all students before deleting.`
            : `This will permanently delete Section ${deleteTarget?.name ?? ""} (${deleteTarget?.batch ?? ""}). This cannot be undone.`
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
