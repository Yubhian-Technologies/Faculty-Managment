"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Upload, Download, Search, Users, Pencil } from "lucide-react";
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
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import {
  RosterFormFields, RosterDetailView, departmentsOfferingCourse, yearOptionsForDepartment, yearOptionsForCourse,
} from "@/components/students/RosterFieldInputs";
import { freshmanLandingDepartmentNames, type DepartmentWithId } from "@/lib/college/academicStructure";
import {
  EDITABLE_ROSTER_FIELDS, LIST_ROSTER_FIELDS,
  rosterFieldDisplay, rosterFieldFormValue, rosterFormToPayload,
} from "@/lib/students/rosterFields";
import { toCSV, downloadCSV } from "@/lib/utils/csv";
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

const DEFAULT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function OfficeStudentsPage() {
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseNames, setCourseNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  // `search` is the input's live value; `debouncedSearch` is what actually
  // drives the server request - typing shouldn't fire a database query per
  // keystroke. Page reset happens alongside the debounced value (see
  // onSearchChange) so a search doesn't cause two requests (one for the stale
  // text at page 1, one for the debounced text).
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deptFilter, setDeptFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [studentTypeFilter, setStudentTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [addOpen, setAddOpen] = useState(false);
  // Set when the dialog is editing an existing student rather than adding one -
  // both use the same form body, so this is what tells them apart.
  const [editTarget, setEditTarget] = useState<StudentListItem | null>(null);
  const [form, setForm] = useState<RosterForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [viewTarget, setViewTarget] = useState<StudentListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Bulk removal: selection is keyed by student id and persists across page/
  // filter changes, so "filter by department, select all, delete" (department-
  // wide removal) and "clear filters, select all, delete" (remove everyone)
  // both fall out of the same mechanism as picking individual rows - no
  // separate "delete all" / "delete by department" actions needed. The header
  // checkbox only reaches the current page (standard for a paginated table);
  // "Select all N matching" below is the deliberate, explicit way to extend a
  // selection to every student the current filters match, not just this page.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // CSV export - a separate, deliberately unrestricted multi-select (any
  // combination of course/department/year, or none at all for "everyone")
  // rather than reusing the single-value list filters above. Firestore
  // querying happens server-side (fetchStudentsForExport); an empty
  // selection in any group means "don't filter on that dimension".
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCourses, setExportCourses] = useState<string[]>([]);
  const [exportDepartments, setExportDepartments] = useState<string[]>([]);
  const [exportYears, setExportYears] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  const loadMetadata = useCallback(async () => {
    try {
      const [deptsRes, yearsRes, coursesRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears?: AcademicYear[] }>).catch(() => ({ academicYears: [] })),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).catch(() => ({ courses: [] })),
      ]);
      setDepartments(deptsRes.departments ?? []);
      const loadedCourses = coursesRes.courses ?? [];
      setCourses(loadedCourses);
      // Every department owns its own Course doc for the same programme, so
      // the raw list repeats "Bachelor of Technology" once per department -
      // the picker wants the distinct programme names.
      setCourseNames(
        Array.from(new Set(loadedCourses.map((c) => c.name?.trim()).filter(Boolean) as string[]))
          .sort((a, b) => a.localeCompare(b))
      );
      // Prefer the college's configured academic years; a sensible 1-4 default
      // so the dropdowns are never empty for a freshly set-up college.
      const configured = (yearsRes.academicYears ?? []).map((y) => y.yearNumber).filter(Boolean);
      // The college-wide Academic Years list (Principal-managed, sequential
      // add/remove) has no idea which years any real course actually reaches
      // - it can carry more years than the longest course the college offers,
      // which would otherwise sit in the Year filter as a dead option no
      // student can ever have. Cap at the longest real course duration - the
      // same cap the Principal's own Years Taught editor already enforces.
      const maxCourseDuration = loadedCourses.reduce((max, c) => Math.max(max, Number(c.durationYears) || 0), 0);
      const capped = maxCourseDuration > 0 ? configured.filter((y) => y <= maxCourseDuration) : configured;
      setYears(capped.length > 0 ? capped : [1, 2, 3, 4]);
    } catch {
      toast({ variant: "destructive", title: "Failed to load filter options" });
    }
  }, []);

  const loadStudents = useCallback(async () => {
    setIsFetching(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (deptFilter !== "all") params.set("department", deptFilter);
      if (courseFilter !== "all") params.set("course", courseFilter);
      if (yearFilter !== "all") params.set("year", yearFilter);
      if (studentTypeFilter !== "all") params.set("studentType", studentTypeFilter);

      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as { students?: StudentListItem[]; total?: number; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load students" });
        return;
      }
      const data = json.students ?? [];
      const grandTotal = json.total ?? 0;
      // The page we asked for came back empty even though matches exist - the
      // row that used to be here was just deleted, or a filter change
      // narrowed the count out from under the page we were on. Step back to
      // the last real page instead of leaving a blank table.
      if (data.length === 0 && page > 1 && grandTotal > 0) {
        setPage(Math.max(1, Math.ceil(grandTotal / pageSize)));
        return;
      }
      setStudents(data);
      setTotal(grandTotal);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsFetching(false);
      setIsLoading(false);
    }
  }, [page, pageSize, debouncedSearch, deptFilter, courseFilter, yearFilter, studentTypeFilter]);

  // Wrapped so the loaders' setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await loadMetadata(); })();
  }, [loadMetadata]);

  useEffect(() => {
    void (async () => { await loadStudents(); })();
  }, [loadStudents]);

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );

  // Course -> Department -> Year cascade: once a course is picked, only the
  // department(s) that actually own a Course doc for it are offered; once a
  // department is picked (with whichever course, if any, is set), only the
  // years that department actually teaches for it are offered. Reuses the
  // same resolution the Add/Edit form's own Course/Department/Year fields
  // already use (RosterFieldInputs.tsx), so a filter never suggests a
  // department/year combination that couldn't really exist.
  const departmentFilterOptions = useMemo(() => {
    if (courseFilter === "all") return activeDepartments;
    const offeringIds = new Set(departmentsOfferingCourse(departments, courses, courseFilter).map((d) => d.id));
    return activeDepartments.filter((d) => offeringIds.has(d.id));
  }, [courseFilter, activeDepartments, departments, courses]);

  const yearFilterOptions = useMemo(() => {
    if (deptFilter !== "all") {
      return yearOptionsForDepartment(departments, courses, deptFilter, courseFilter === "all" ? "" : courseFilter, years);
    }
    // No department picked yet - still cap by the chosen course's own Years
    // Taught duration (Course.durationYears, set by the Principal), rather
    // than falling all the way back to every college-configured year.
    return yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years);
  }, [deptFilter, courseFilter, departments, courses, years]);

  // Same Course -> Department -> Year cascade as the filter bar above, but
  // multi-select: each group's options are the UNION of what's valid across
  // every currently-selected value in the group(s) upstream of it, since more
  // than one course/department can be picked at once. A selection that falls
  // out of range when an upstream group narrows (e.g. Department picked, then
  // Course narrowed to something that department doesn't offer) is dropped
  // from what's shown/sent here - derived on every render rather than pruned
  // via an effect, so it can't drift from what's actually still valid.
  // Course must be picked before Department has anything to offer - showing
  // every department in the college by default (before any course is even
  // chosen) is confusing clutter (e.g. both "BASIC SCIENCE" and its own
  // sub-departments listed side by side with no context narrowing them).
  // Year deliberately stays independent of this (see its own hint below) -
  // "export every Year 1 student, regardless of course/department" is a
  // common, legitimate export this dialog's own "leave a group empty to
  // include all" design exists for.
  const exportDepartmentOptions = useMemo(() => {
    if (exportCourses.length === 0) return [];
    const offeringIds = new Set(
      exportCourses.flatMap((c) => departmentsOfferingCourse(departments, courses, c).map((d) => d.id))
    );
    return activeDepartments.filter((d) => offeringIds.has(d.id));
  }, [exportCourses, activeDepartments, departments, courses]);

  const effectiveExportDepartments = useMemo(
    () => exportDepartments.filter((name) => exportDepartmentOptions.some((d) => d.name === name)),
    [exportDepartments, exportDepartmentOptions]
  );

  const exportYearOptions = useMemo(() => {
    const courseList = exportCourses.length > 0 ? exportCourses : [""];
    const allowed = new Set<number>();
    if (effectiveExportDepartments.length > 0) {
      for (const dept of effectiveExportDepartments) {
        for (const c of courseList) {
          for (const y of yearOptionsForDepartment(departments, courses, dept, c, years)) allowed.add(y);
        }
      }
    } else if (exportCourses.length > 0) {
      for (const c of exportCourses) {
        for (const y of yearOptionsForCourse(courses, c, years)) allowed.add(y);
      }
    } else {
      return years;
    }
    return Array.from(allowed).sort((a, b) => a - b);
  }, [exportCourses, effectiveExportDepartments, departments, courses, years]);

  const effectiveExportYears = useMemo(
    () => exportYears.filter((y) => exportYearOptions.includes(Number(y))),
    [exportYears, exportYearOptions]
  );

  function onSearchChange(value: string) {
    setSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim().toLowerCase());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  }

  function onCourseFilterChange(value: string) {
    const nextDeptOptions = value === "all"
      ? activeDepartments
      : activeDepartments.filter((d) => new Set(departmentsOfferingCourse(departments, courses, value).map((o) => o.id)).has(d.id));
    const deptStillValid = deptFilter === "all" || nextDeptOptions.some((d) => d.name === deptFilter);
    const nextDept = deptStillValid ? deptFilter : "all";
    if (!deptStillValid) setDeptFilter("all");
    const nextYearOptions = nextDept === "all"
      ? yearOptionsForCourse(courses, value === "all" ? undefined : value, years)
      : yearOptionsForDepartment(departments, courses, nextDept, value === "all" ? "" : value, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setCourseFilter(value);
    setPage(1);
  }

  function onDeptFilterChange(value: string) {
    const nextYearOptions = value === "all"
      ? yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years)
      : yearOptionsForDepartment(departments, courses, value, courseFilter === "all" ? "" : courseFilter, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setDeptFilter(value);
    setPage(1);
  }

  function onYearFilterChange(value: string) {
    setYearFilter(value);
    setPage(1);
  }

  function onStudentTypeFilterChange(value: string) {
    setStudentTypeFilter(value);
    setPage(1);
  }

  function onPageSizeChange(value: number) {
    setPageSize(value);
    setPage(1);
  }

  // Trusting `selected` directly (no cross-check against the currently loaded
  // page) is safe here: only one page of students is ever held in memory at
  // once, so a selection made on another page can't be re-validated locally -
  // and the bulk-delete endpoint already tolerates and reports an id that's
  // no longer live as "skipped" rather than erroring.
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const selectedCount = selectedIds.length;
  const allPageSelected = students.length > 0 && students.every((s) => selected[s.id]);
  const somePageSelected = students.some((s) => selected[s.id]);

  function toggleSelectAllOnPage(checked: boolean | "indeterminate") {
    const shouldSelect = checked === true;
    setSelected((prev) => {
      const next = { ...prev };
      for (const s of students) {
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

  async function selectAllMatching() {
    setIsSelectingAll(true);
    try {
      const params = new URLSearchParams();
      params.set("idsOnly", "1");
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (deptFilter !== "all") params.set("department", deptFilter);
      if (courseFilter !== "all") params.set("course", courseFilter);
      if (yearFilter !== "all") params.set("year", yearFilter);
      if (studentTypeFilter !== "all") params.set("studentType", studentTypeFilter);
      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as { ids?: string[]; error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Failed to select all matching students" }); return; }
      setSelected((prev) => {
        const next = { ...prev };
        for (const id of json.ids ?? []) next[id] = true;
        return next;
      });
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsSelectingAll(false);
    }
  }

  // Exports every student matching the chosen course(s)/department(s)/year(s)
  // - any combination, or none at all for "everyone" - as a CSV, with every
  // roster field plus current Section/Status. Fetches straight from the
  // server (fetchStudentsForExport), never from the one page of `students`
  // already in memory, since an export routinely spans far more than one page.
  async function handleExport() {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("export", "1");
      if (exportCourses.length > 0) params.set("courses", exportCourses.join(","));
      if (effectiveExportDepartments.length > 0) params.set("departments", effectiveExportDepartments.join(","));
      if (effectiveExportYears.length > 0) params.set("years", effectiveExportYears.join(","));
      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as { students?: StudentListItem[]; total?: number; truncated?: boolean; error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Failed to export students" }); return; }
      const rows = json.students ?? [];
      if (rows.length === 0) {
        toast({ variant: "destructive", title: "No students match the selected filters" });
        return;
      }
      const headers = [...EDITABLE_ROSTER_FIELDS.map((f) => f.label), "Section", "Status"];
      const csvRows = rows.map((s) => [
        ...EDITABLE_ROSTER_FIELDS.map((f) => rosterFieldDisplay(f, s)),
        s.section || "",
        s.status || "",
      ]);
      downloadCSV(toCSV([headers, ...csvRows]), `students_export_${new Date().toISOString().slice(0, 10)}.csv`);
      toast({
        variant: "success",
        title: `Exported ${rows.length} student${rows.length === 1 ? "" : "s"}`
          + (json.truncated ? ` (of ${json.total} matching - narrow your filters to get the rest)` : ""),
      });
      setExportOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsExporting(false);
    }
  }

  function toggleInList(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
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
    if (!form.course) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (!form.department) { toast({ variant: "destructive", title: "Department is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Academic Year is required" }); return; }
    // Add only - department/year aren't editable via this form on Edit (see
    // its own comment below). A 1st-year student at a college that runs a
    // shared first year must land under a Basic Science (Freshman)
    // department with a Core Department named - same rule RosterFieldInputs
    // already steers the pickers toward and the server enforces on submit.
    if (!editTarget && form.year === "1") {
      const freshmanNames = freshmanLandingDepartmentNames(departments as DepartmentWithId[]);
      if (freshmanNames.size > 0 && !freshmanNames.has(form.department)) {
        toast({ variant: "destructive", title: `"${form.department}" is a real branch - set it as Core Department instead of Department for a 1st Year student` });
        return;
      }
      if (freshmanNames.size > 0 && !form.secondaryDepartment) {
        toast({ variant: "destructive", title: "Core Department is required for 1st Year students" });
        return;
      }
    }

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
      void loadStudents();
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
      void loadStudents();
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
      void loadStudents();
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
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <Download className="h-4 w-4 mr-2" />Export
            </Button>
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
        <span><strong className="text-foreground">{total}</strong> students total</span>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, roll number or email"
            className="pl-9"
          />
        </div>
        <Select value={courseFilter} onValueChange={onCourseFilterChange}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All courses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {courseNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={onDeptFilterChange}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departmentFilterOptions.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={yearFilter} onValueChange={onYearFilterChange}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="All years" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {yearFilterOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={studentTypeFilter} onValueChange={onStudentTypeFilterChange}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="Regular">Regular</SelectItem>
            <SelectItem value="Lateral">Lateral</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk actions - appears once at least one row is selected. Selecting
          every row of a department- or year-filtered list (via "Select all N
          matching" once the page is fully checked) is how "delete this
          department" / "delete all students" are done, rather than separate
          dedicated actions. */}
      {selectedCount > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              <strong className="text-foreground">{selectedCount}</strong> student{selectedCount === 1 ? "" : "s"} selected
            </span>
            {allPageSelected && selectedCount < total && (
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void selectAllMatching()} disabled={isSelectingAll}>
                {isSelectingAll ? "Selecting…" : `Select all ${total} matching`}
              </Button>
            )}
          </div>
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
      ) : students.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">{total === 0 ? "No students yet" : "No students match your filters"}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {total === 0 ? "Add a student manually or import a roster to get started." : "Try clearing the search or filters."}
          </p>
          {total === 0 && <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Student</Button>}
        </div>
      ) : (
        <Card>
          {/* Keeps the previous page's rows visible (rather than swapping to a
              skeleton) while a page/filter change is in flight, so the table
              doesn't flicker or reflow for every navigation - only dimmed to
              signal a refresh is happening. */}
          <CardContent className={`p-0 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {/* The template's identity columns and nothing else - the rest
                    of the admission detail (gender, contacts, email …) is a
                    click away in the detail dialog rather than widening this
                    table. S.No is the row's position on the current page. */}
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium w-10">
                      <Checkbox
                        checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                        onCheckedChange={toggleSelectAllOnPage}
                        aria-label="Select all on this page"
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
                  {students.map((s, i) => (
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
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{(page - 1) * pageSize + i + 1}</td>
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

      {!isLoading && total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={onPageSizeChange}
          disabled={isFetching}
        />
      )}

      {/* ── Export ── */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Export Students</DialogTitle>
            <DialogDescription>
              Pick a Course first - Department only appears once at least one is selected, since
              a department&apos;s options depend on it. Leave Department or Academic Year empty
              to include all of it (Academic Year is independent - it doesn&apos;t require a
              Course or Department to be picked). Every roster field is included in the CSV.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            <ExportFilterGroup
              title="Course"
              options={courseNames.map((name) => ({
                value: name,
                label: name,
                code: courses.find((c) => c.name === name)?.code,
              }))}
              selected={exportCourses}
              onToggle={(v) => setExportCourses((prev) => toggleInList(prev, v))}
              onClear={() => setExportCourses([])}
            />
            <ExportFilterGroup
              title="Department"
              hint={exportCourses.length > 0
                ? "Narrowed to departments offering the selected course(s)."
                : "Select a course above first - department options will appear here."}
              options={exportDepartmentOptions.map((d) => ({ value: d.name, label: d.name, code: d.code }))}
              selected={effectiveExportDepartments}
              onToggle={(v) => setExportDepartments((prev) => toggleInList(prev, v))}
              onClear={() => setExportDepartments([])}
            />
            <ExportFilterGroup
              title="Academic Year"
              hint={exportCourses.length > 0 || effectiveExportDepartments.length > 0
                ? "Narrowed to years actually taught for the selection above." : undefined}
              options={exportYearOptions.map((y) => ({ value: String(y), label: ordinalYear(y) }))}
              selected={effectiveExportYears}
              onToggle={(v) => setExportYears((prev) => toggleInList(prev, v))}
              onClear={() => setExportYears([])}
              columns={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleExport()} loading={isExporting}>
              <Download className="h-4 w-4 mr-2" />Export CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

interface ExportFilterOption {
  value: string;
  label: string;
  /** Short code shown as a badge before the label (e.g. a department's "IT", a course's "BTECH"). */
  code?: string;
}

/**
 * A labeled checkbox group for the Export dialog - "All" (empty selection)
 * reads as "no filter on this dimension", so there's no explicit "All"
 * checkbox to pick; "Clear" just empties the selection back to that state.
 *
 * Full-width rows by default (`columns` unset) - department/course names run
 * long (e.g. "ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING"), and a
 * multi-column grid with `truncate` was cutting them off mid-word. Only the
 * Academic Year group (short labels) opts into a denser grid via `columns`.
 */
function ExportFilterGroup({
  title, hint, options, selected, onToggle, onClear, columns,
}: {
  title: string;
  hint?: string;
  options: ExportFilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  columns?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium">{title}</p>
        <span className="text-xs text-muted-foreground">
          {selected.length === 0 ? "All" : `${selected.length} selected`}
          {selected.length > 0 && (
            <button type="button" onClick={onClear} className="ml-2 text-primary hover:underline">Clear</button>
          )}
        </span>
      </div>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-lg border p-3">
          No options available{hint ? " for the current selection above." : "."}
        </p>
      ) : (
        <div
          className="grid gap-x-4 gap-y-2 rounded-lg border p-3 max-h-48 overflow-y-auto"
          style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
        >
          {options.map((o) => (
            <label key={o.value} className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                className="mt-0.5 shrink-0"
                checked={selected.includes(o.value)}
                onCheckedChange={() => onToggle(o.value)}
              />
              <span className="min-w-0">
                {o.code && (
                  <Badge variant="secondary" className="mr-1.5 align-middle text-[10px] px-1.5 py-0">{o.code}</Badge>
                )}
                <span className="align-middle break-words">{o.label}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
