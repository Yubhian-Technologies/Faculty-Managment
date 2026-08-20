"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Upload, Search, Users, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { RosterFormFields, RosterDetailView } from "@/components/students/RosterFieldInputs";
import {
  EDITABLE_ROSTER_FIELDS, LIST_ROSTER_FIELDS,
  rosterFieldDisplay, rosterFieldFormValue, rosterFormToPayload,
} from "@/lib/students/rosterFields";
import type { StudentListItem, Department, AcademicYear, Course } from "@/types";

// The Add and Edit forms collect every field the roster import collects, in the
// template's order - see src/lib/students/rosterFields.ts, the one definition
// all of this reads from. Previously Add asked for 7 of the 35, so a manually
// added student silently carried less than an imported one.
//
// Section is still not collected: like the import, every manual add is
// "unassigned" and the department (sub-)HOD sections the student later. Roll No
// IS offered at intake (it's a template column, provisional only), but is
// read-only when editing - correcting it afterwards is the department's, and
// theirs is the only path that checks it for uniqueness.
type RosterForm = Record<string, string>;

const EMPTY_FORM: RosterForm = Object.fromEntries(
  EDITABLE_ROSTER_FIELDS.map((f) => [f.key, ""])
);

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function OfficeStudentsPage() {
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseNames, setCourseNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");

  const [addOpen, setAddOpen] = useState(false);
  // Set when the dialog is editing an existing student rather than adding one -
  // both use the same form body, so this is what tells them apart.
  const [editTarget, setEditTarget] = useState<StudentListItem | null>(null);
  const [form, setForm] = useState<RosterForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [viewTarget, setViewTarget] = useState<StudentListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Bulk removal: selection is keyed by student id and persists across filter
  // changes, so "filter by department, select all, delete" (department-wide
  // removal) and "clear filters, select all, delete" (remove everyone) both
  // fall out of the same mechanism as picking individual rows - no separate
  // "delete all" / "delete by department" actions needed.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [studentsRes, deptsRes, yearsRes, coursesRes] = await Promise.all([
        fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentListItem[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears?: AcademicYear[] }>).catch(() => ({ academicYears: [] })),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).catch(() => ({ courses: [] })),
      ]);
      const loaded = studentsRes.students ?? [];
      setStudents(loaded);
      setDepartments(deptsRes.departments ?? []);
      const loadedCourses = coursesRes.courses ?? [];
      setCourses(loadedCourses);
      // Every department owns its own Course doc for the same programme, so
      // the raw list repeats "Bachelor of Technology" once per department -
      // the picker wants the distinct programme names, which is also what
      // `course` stores (free text, see StudentRecord.course). The raw list
      // above is kept too, so the Year/Secondary Department fields can still
      // resolve which specific department+course combination (and therefore
      // which per-course courseScopes override) was picked.
      setCourseNames(
        Array.from(new Set(loadedCourses.map((c) => c.name?.trim()).filter(Boolean) as string[]))
          .sort((a, b) => a.localeCompare(b))
      );
      // Prefer the college's configured academic years; fall back to whatever
      // years already appear on students, then to a sensible 1-4 default so the
      // dropdowns are never empty for a freshly set-up college.
      const configured = (yearsRes.academicYears ?? []).map((y) => y.yearNumber).filter(Boolean);
      const fromStudents = Array.from(new Set(loaded.map((s) => s.year).filter(Boolean)));
      const merged = Array.from(new Set([...configured, ...fromStudents])).sort((a, b) => a - b);
      // The college-wide Academic Years list (Principal-managed, sequential
      // add/remove) has no idea which years any real course actually reaches
      // - it can carry more years than the longest course the college offers
      // (e.g. a stray "5th Year" nothing under a 4-year B.Tech ever uses),
      // which would otherwise sit in the Year filter and the Add/Edit form's
      // fallback Year picker as a dead option no student can ever have. Cap
      // at the longest real course duration - the same cap the Principal's
      // own Years Taught editor already enforces at the source.
      const maxCourseDuration = loadedCourses.reduce((max, c) => Math.max(max, Number(c.durationYears) || 0), 0);
      const capped = maxCourseDuration > 0 ? merged.filter((y) => y <= maxCourseDuration) : merged;
      setYears(capped.length > 0 ? capped : [1, 2, 3, 4]);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Wrapped so the loader's setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      // A shared-first-year student stays filed under their common department
      // (preserved until promotion) with secondaryDepartment naming their
      // real destination branch instead - filtering by department alone
      // would silently drop them from a filter/bulk-delete by their real
      // branch, which is exactly how "delete a department's students" is
      // done on this page (select-all after filtering).
      if (deptFilter !== "all" && s.department !== deptFilter && s.secondaryDepartment !== deptFilter) return false;
      if (yearFilter !== "all" && s.year !== Number(yearFilter)) return false;
      if (courseFilter !== "all" && s.course !== courseFilter) return false;
      if (q && !(
        s.name.toLowerCase().includes(q)
        || (s.rollNumber ?? "").toLowerCase().includes(q)
        || (s.email ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [students, search, deptFilter, yearFilter, courseFilter]);

  // Filtered against the live roster (not just truthy in `selected`) so a
  // selection made before another edit/delete elsewhere reloads the list
  // never counts or submits an id that no longer exists.
  const selectedIds = useMemo(() => {
    const liveIds = new Set(students.map((s) => s.id));
    return Object.keys(selected).filter((id) => selected[id] && liveIds.has(id));
  }, [selected, students]);
  const selectedCount = selectedIds.length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected[s.id]);
  const someFilteredSelected = filtered.some((s) => selected[s.id]);

  function toggleSelectAllFiltered(checked: boolean | "indeterminate") {
    const shouldSelect = checked === true;
    setSelected((prev) => {
      const next = { ...prev };
      for (const s of filtered) {
        if (shouldSelect) next[s.id] = true;
        else delete next[s.id];
      }
      return next;
    });
  }

  function toggleSelectOne(id: string, checked: boolean | "indeterminate") {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked === true) next[id] = true;
      else delete next[id];
      return next;
    });
  }

  function setF(key: string, value: string) { setForm((f) => ({ ...f, [key]: value })); }

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setAddOpen(true);
  }

  function openEdit(s: StudentListItem) {
    setEditTarget(s);
    setForm(
      Object.fromEntries(
        EDITABLE_ROSTER_FIELDS.map((f) => [f.key, rosterFieldFormValue(f, s)])
      ) as RosterForm
    );
    setViewTarget(null);
    setAddOpen(true);
  }

  async function handleSave() {
    if (!form.name?.trim()) { toast({ variant: "destructive", title: "Name is required" }); return; }
    if (!form.department) { toast({ variant: "destructive", title: "Department is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Academic Year is required" }); return; }

    setSaving(true);
    try {
      // On Edit, a blank field must overwrite (clear) whatever the student
      // currently has - not be silently dropped as if never provided (which
      // previously made "clear Secondary Department" a no-op with a
      // deceptive "updated" success toast).
      const payload = rosterFormToPayload(form, { writeBlanksAsNull: !!editTarget });
      // Editing sends only the detail fields - name/department/year stay as
      // they are, since moving a student between departments or years is the
      // promotion/section flow's job, not a field edit.
      const res = editTarget
        ? await fetch(`/api/college/students/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ details: payload }),
          })
        : await fetch("/api/college/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? (editTarget ? "Failed to save changes" : "Failed to add student") });
        return;
      }
      toast({ variant: "success", title: `${form.name.trim()} ${editTarget ? "updated" : "added"}` });
      setAddOpen(false);
      setEditTarget(null);
      setForm(EMPTY_FORM);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/students/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Failed to remove" }); return; }
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsDeleting(false);
    }
  }

  // The server caps a single call at 400 students (matches students/promote),
  // so a large "delete all" selection is sent as sequential chunks from here
  // rather than requiring the Office to split it up themselves.
  const BULK_DELETE_CHUNK_SIZE = 400;

  async function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    setIsBulkDeleting(true);
    setBulkProgress({ done: 0, total: selectedIds.length });
    let deletedTotal = 0;
    let skippedTotal = 0;
    try {
      for (let i = 0; i < selectedIds.length; i += BULK_DELETE_CHUNK_SIZE) {
        const chunk = selectedIds.slice(i, i + BULK_DELETE_CHUNK_SIZE);
        const res = await fetch("/api/college/students/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentIds: chunk }),
        });
        const json = await res.json() as { deletedCount?: number; skipped?: string[]; error?: string };
        if (!res.ok) {
          toast({ variant: "destructive", title: json.error ?? "Failed to remove some students" });
          break;
        }
        deletedTotal += json.deletedCount ?? 0;
        skippedTotal += json.skipped?.length ?? 0;
        setBulkProgress({ done: Math.min(i + chunk.length, selectedIds.length), total: selectedIds.length });
      }
      if (deletedTotal > 0) {
        toast({
          variant: "success",
          title: `${deletedTotal} student${deletedTotal === 1 ? "" : "s"} removed${skippedTotal ? ` (${skippedTotal} already gone)` : ""}`,
        });
      }
      setBulkDeleteOpen(false);
      setSelected({});
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsBulkDeleting(false);
      setBulkProgress(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Add, view and remove students - or bulk-import a roster"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/college-office/students/import"><Upload className="h-4 w-4 mr-2" />Import</Link>
            </Button>
            <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Student</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span><strong className="text-foreground">{students.length}</strong> students total</span>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, roll number or email"
            className="pl-9"
          />
        </div>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All courses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {courseNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {activeDepartments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="All years" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk actions - appears once at least one row is selected. Selecting
          every row of a department- or year-filtered list is how "delete this
          department" / "delete all students" are done, rather than separate
          dedicated actions. */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
          <span className="text-sm">
            <strong className="text-foreground">{selectedCount}</strong> student{selectedCount === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected({})}>Clear selection</Button>
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" />Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">{students.length === 0 ? "No students yet" : "No students match your filters"}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {students.length === 0 ? "Add a student manually or import a roster to get started." : "Try clearing the search or filters."}
          </p>
          {students.length === 0 && <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Student</Button>}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {/* The template's identity columns and nothing else - the rest
                    of the admission detail (gender, contacts, email …) is a
                    click away in the detail dialog rather than widening this
                    table. S.No is the row's position in the current filtered
                    list, matching the sheet column it's named after. */}
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium w-10">
                      <Checkbox
                        checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                        onCheckedChange={toggleSelectAllFiltered}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="p-3 font-medium">S.No</th>
                    {LIST_ROSTER_FIELDS.map((f) => (
                      <th key={f.key} className="p-3 font-medium whitespace-nowrap">{f.label}</th>
                    ))}
                    <th className="p-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr
                      key={s.id}
                      onClick={() => setViewTarget(s)}
                      className={`border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors ${i % 2 === 0 ? "" : "bg-muted/20"}`}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={!!selected[s.id]}
                          onCheckedChange={(checked) => toggleSelectOne(s.id, checked)}
                          aria-label={`Select ${s.name}`}
                        />
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{i + 1}</td>
                      {LIST_ROSTER_FIELDS.map((f) => {
                        const value = rosterFieldDisplay(f, s);
                        return (
                          <td key={f.key} className={`p-3 whitespace-nowrap ${f.key === "name" ? "font-medium" : ""}`}>
                            {value || <span className="text-muted-foreground/50">—</span>}
                          </td>
                        );
                      })}
                      {/* stopPropagation so the row's own "open details" click
                          doesn't fire behind the action being taken. */}
                      <td className="p-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit student"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}
                          className="p-1.5 rounded-md hover:bg-red-100 text-red-600 transition-colors"
                          title="Remove student"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Student detail ── */}
      <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) setViewTarget(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewTarget?.name}</DialogTitle>
            <DialogDescription>
              Every field the roster template carries, in its order - identity first,
              then the rest of the admission detail.
            </DialogDescription>
          </DialogHeader>

          {/* Section and status aren't roster-template fields (the department
              assigns the section later, so the sheet has no column for it) but
              they're the Office's cue for who still needs sectioning - shown
              here since the list no longer carries a Section column. */}
          {viewTarget && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Section:</span>
              {viewTarget.section
                ? <Badge variant="secondary" className="text-xs">{viewTarget.section}</Badge>
                : <span className="italic text-muted-foreground">Unassigned</span>}
              <span className="text-muted-foreground ml-3">Status:</span>
              <Badge variant="secondary" className="text-xs">{viewTarget.status}</Badge>
            </div>
          )}

          {viewTarget && <RosterDetailView student={viewTarget} />}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
            {viewTarget && (
              <Button onClick={() => openEdit(viewTarget)}>
                <Pencil className="h-4 w-4 mr-2" />Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit Student dialog ── */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setEditTarget(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit ${editTarget.name}` : "Add Student"}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? "The same fields as the roster import. Department and Academic Year are shown for context - moving a student between them is done through sectioning and promotion, not here."
                : "The same fields as the roster import. The student is added as unassigned - the department assigns their section later."}
            </DialogDescription>
          </DialogHeader>

          <RosterFormFields
            values={form}
            onChange={setF}
            departments={activeDepartments}
            courseNames={courseNames}
            courses={courses}
            years={years}
            // Department and Year are read-only on Edit to match what this
            // dialog's own description already promises ("shown for context") -
            // students/[id] PATCH's roster-detail-edit path silently drops both
            // (see ROSTER_DETAIL_KEYS), so leaving them as live Selects let an
            // office user click a different department and, on Save, have that
            // click silently discarded while its side effect of clearing
            // Secondary Department (and, now, Course when it no longer matches)
            // was NOT discarded - a confusing partial save. Locking them stops
            // that click from happening at all.
            readOnlyKeys={editTarget ? ["rollNumber", "department", "year"] : []}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setEditTarget(null); }}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              {editTarget ? "Save Changes" : "Add Student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Remove ${deleteTarget?.name ?? ""}?`}
        description={`This will permanently remove ${deleteTarget?.name ?? "this student"}${deleteTarget?.department ? ` (${deleteTarget.department}, ${ordinalYear(deleteTarget.year)})` : ""}. This cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />

      {/* ── Bulk remove confirm ── */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => { if (!open && !isBulkDeleting) setBulkDeleteOpen(false); }}
        title={`Remove ${selectedCount} student${selectedCount === 1 ? "" : "s"}?`}
        description={
          `This will permanently remove ${selectedCount} student${selectedCount === 1 ? "" : "s"}. This cannot be undone.`
          + (bulkProgress ? ` Removing ${bulkProgress.done} of ${bulkProgress.total}…` : "")
        }
        confirmLabel="Remove All"
        variant="destructive"
        onConfirm={() => void handleBulkDelete()}
        loading={isBulkDeleting}
      />
    </div>
  );
}
