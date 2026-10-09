"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2, Upload, Download, Search, Users, Pencil, KeyRound, FileText } from "lucide-react";
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
import { departmentsOfferingCourse, yearOptionsForDepartment, yearOptionsForCourse } from "@/components/students/RosterFieldInputs";
import { StudentFormDialog } from "@/components/students/StudentFormDialog";
import { StudentPasswordDialog } from "@/components/students/StudentPasswordDialog";
import { EDITABLE_ROSTER_FIELDS, LIST_ROSTER_FIELDS, rosterFieldDisplay } from "@/lib/students/rosterFields";
import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { GraduatedStudentsView } from "@/components/students/GraduatedStudentsView";
import { StudentPromotionsPanel } from "@/components/students/StudentPromotionsPanel";
import { StudentStrengthDashboard } from "@/components/students/StudentStrengthDashboard";
import { StudentsViewTabs } from "@/components/students/StudentsViewTabs";
import type { StudentListItem, Department, AcademicYear, Course } from "@/types";
import { selectableYears } from "@/lib/college/courseYears";
import { coreDepartmentOptions as buildCoreDepartmentOptions, departmentFilterOptions as buildDepartmentFilterOptions } from "@/lib/departments/departmentTree";
import { useSectionDepartments } from "@/hooks/useSectionDepartments";
import { useListUrlSync } from "@/hooks/useListUrlSync";
import { buildListUrl, readListChoice, readListInt, readListString, withListBack } from "@/lib/listReturn";

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
// The Add/Edit form itself (fields, validation, save request) lives in
// StudentFormDialog - the single canonical implementation this page and the
// Student profile page's own Edit button both use.

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZES = [10, 20, 30, 50]; // Pagination's options
const LIST_PATH = "/college-office/students";

// What a list request is filtered by - the values behind the filter bar, frozen
// at the moment Load was pressed. Empty string / "all" mean "no filter".
interface StudentListFilters {
  search: string;
  department: string;
  /** The branch a feeder department is narrowed to - the student's Core Department. */
  coreDepartment: string;
  /**
   * The years the picked department is configured to teach, comma-separated -
   * what "All years" means once a department is chosen. Empty when no
   * department is picked, where "All years" still means every year.
   */
  years: string;
  course: string;
  year: string;
  studentType: string;
  rollFrom: string;
  rollTo: string;
}

function filtersToParams(f: StudentListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.search) params.set("search", f.search);
  if (f.department !== "all") params.set("department", f.department);
  if (f.coreDepartment !== "all") params.set("coreDepartment", f.coreDepartment);
  if (f.year === "all" && f.years) params.set("years", f.years);
  if (f.course !== "all") params.set("course", f.course);
  if (f.year !== "all") params.set("year", f.year);
  if (f.studentType !== "all") params.set("studentType", f.studentType);
  if (f.rollFrom) params.set("rollFrom", f.rollFrom);
  if (f.rollTo) params.set("rollTo", f.rollTo);
  return params;
}

// Graduated Students used to be its own sidebar entry (/college-office/graduates);
// it now lives here as a sub-tab (top-right pill), matching the pattern
// principal/students already uses - see PrincipalStudentsPage. The old route
// still works standalone for any existing bookmarks/links. Promotion is the
// same StudentPromotionsPanel Principal/VP use (POST /api/college/students/promote,
// which now also accepts COLLEGE_OFFICE) - College Office runs the cohort
// promotion/graduation itself rather than asking Principal to.
const STUDENT_TABS = [
  { key: "roster", label: "All Students" },
  { key: "strength", label: "Students Strength" },
  { key: "promotion", label: "Promotion" },
  { key: "graduates", label: "Graduated" },
] as const;
type StudentTabKey = (typeof STUDENT_TABS)[number]["key"];

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Selection checkboxes on this list (header "select all" + every row) - same
// treatment as hod/faculty/page.tsx's own SELECT_CHECKBOX_CLASS: a bit larger
// than the shared Checkbox default, with a clear 2px black border and a white
// fill so an unchecked box reads against the white table. Applied via
// className here so the shared Checkbox - used across the app - keeps its
// default look everywhere else.
const SELECT_CHECKBOX_CLASS =
  "h-5 w-5 border-2 border-black bg-white hover:border-primary [&_svg]:h-3.5 [&_svg]:w-3.5 " +
  "data-[state=checked]:border-primary data-[state=indeterminate]:border-primary " +
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground";

function OfficeStudentsContent() {
  const router = useRouter();
  // What the list was showing (tab, applied filters, page) when a student was
  // opened from it, or when the page was refreshed - read once, on arrival; the
  // list then mirrors its own applied state back into the URL (listUrl below).
  const searchParams = useSearchParams();
  const [restored] = useState(() => {
    const yearParam = searchParams.get("year") ?? "";
    const yearsParam = searchParams.get("years") ?? "";
    const filters: StudentListFilters = {
      search: readListString(searchParams, "q", ""),
      department: readListString(searchParams, "department", "all"),
      coreDepartment: readListString(searchParams, "coreDepartment", "all"),
      years: /^\d+(,\d+)*$/.test(yearsParam) ? yearsParam : "",
      course: readListString(searchParams, "course", "all"),
      year: /^\d+$/.test(yearParam) ? yearParam : "all",
      studentType: readListChoice<string>(searchParams, "studentType", ["Regular", "Lateral"], "all"),
      rollFrom: readListString(searchParams, "rollFrom", ""),
      rollTo: readListString(searchParams, "rollTo", ""),
    };
    return {
      load: searchParams.get("load") === "1",
      tab: readListChoice(searchParams, "tab", STUDENT_TABS.map((t) => t.key), "roster"),
      filters,
      page: readListInt(searchParams, "page", 1),
      pageSize: readListInt(searchParams, "pageSize", DEFAULT_PAGE_SIZE, { allowed: PAGE_SIZES }),
    };
  });
  const [activeTab, setActiveTab] = useState<StudentTabKey>(restored.tab);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseNames, setCourseNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // A restored list loads itself on arrival, so it starts out loading rather
  // than flashing the "Load Students" prompt.
  const [isFetching, setIsFetching] = useState(restored.load);

  // The filter controls below (search, course, department, year, type, roll
  // range) only EDIT a draft - nothing is read from the database while they
  // change. `appliedFilters` is the snapshot of that draft taken when the user
  // presses Load (or Enter in a text box), and is the only thing the list
  // request is built from. It stays null until the first Load, so the page
  // reads no students on open. Paging and the page size re-read with the
  // applied snapshot - never with a half-edited draft.
  // A restored list starts with the draft equal to the snapshot it was showing.
  const [search, setSearch] = useState(restored.filters.search);
  const [deptFilter, setDeptFilter] = useState(restored.filters.department);
  const [coreDeptFilter, setCoreDeptFilter] = useState(restored.filters.coreDepartment);
  const [yearFilter, setYearFilter] = useState<string>(restored.filters.year);
  const [courseFilter, setCourseFilter] = useState<string>(restored.filters.course);
  const [studentTypeFilter, setStudentTypeFilter] = useState<string>(restored.filters.studentType);
  const [rollFrom, setRollFrom] = useState(restored.filters.rollFrom);
  const [rollTo, setRollTo] = useState(restored.filters.rollTo);
  const [appliedFilters, setAppliedFilters] = useState<StudentListFilters | null>(restored.load ? restored.filters : null);
  const loadSeq = useRef(0);
  const [page, setPage] = useState(restored.page);
  const [pageSize, setPageSize] = useState(restored.pageSize);

  const [addOpen, setAddOpen] = useState(false);
  // Set when the dialog is editing an existing student rather than adding one -
  // StudentFormDialog tells them apart the same way.
  const [editTarget, setEditTarget] = useState<StudentListItem | null>(null);

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
      // Prefer the college's configured academic years; failing that the years of the longest
      // course the college runs (selectableYears) - never an invented 1-4.
      const configured = (yearsRes.academicYears ?? []).map((y) => y.yearNumber).filter(Boolean);
      // The college-wide Academic Years list (Principal-managed, sequential
      // add/remove) has no idea which years any real course actually reaches
      // - it can carry more years than the longest course the college offers,
      // which would otherwise sit in the Year filter as a dead option no
      // student can ever have. Cap at the longest real course duration - the
      // same cap the Principal's own Years Taught editor already enforces.
      setYears(selectableYears(configured, loadedCourses));
    } catch {
      toast({ variant: "destructive", title: "Failed to load filter options" });
    }
  }, []);

  const loadStudents = useCallback(async () => {
    if (!appliedFilters) return;
    const seq = ++loadSeq.current;
    setIsFetching(true);
    try {
      const params = filtersToParams(appliedFilters);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as { students?: StudentListItem[]; total?: number; error?: string };
      if (seq !== loadSeq.current) return; // a newer Load / page change superseded this one
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
      if (seq === loadSeq.current) toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      if (seq === loadSeq.current) {
        setIsFetching(false);
        setIsLoading(false);
      }
    }
  }, [page, pageSize, appliedFilters]);

  // Wrapped so the loaders' setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await loadMetadata(); })();
  }, [loadMetadata]);

  // Reads students only once Load has produced an applied snapshot, and again
  // when that snapshot, the page or the page size changes - never because a
  // draft filter did.
  useEffect(() => {
    if (!appliedFilters) return;
    void (async () => { await loadStudents(); })();
  }, [loadStudents, appliedFilters]);

  // The list's own URL: tab, the APPLIED filters (what is on screen - not a
  // half-edited draft), page and page size. Kept in the address bar so a refresh
  // or the browser's Back button restores the view, and carried to a student's
  // profile in `?back=` for its Back button.
  const listUrl = useMemo(
    () => buildListUrl(
      LIST_PATH,
      {
        tab: activeTab,
        load: appliedFilters !== null,
        q: appliedFilters?.search, department: appliedFilters?.department, coreDepartment: appliedFilters?.coreDepartment,
        years: appliedFilters?.years, course: appliedFilters?.course, year: appliedFilters?.year,
        studentType: appliedFilters?.studentType, rollFrom: appliedFilters?.rollFrom, rollTo: appliedFilters?.rollTo,
        page, pageSize,
      },
      { tab: "roster", department: "all", coreDepartment: "all", course: "all", year: "all", studentType: "all", page: 1, pageSize: DEFAULT_PAGE_SIZE }
    ),
    [activeTab, appliedFilters, page, pageSize]
  );
  useListUrlSync(listUrl, LIST_PATH);

  // Which departments a section is actually filed under - the Department
  // filter's options are drawn from these, not from the whole department list.
  const sectionDepartments = useSectionDepartments();

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
  //
  // Narrowed once more to the departments that actually resolve to sections -
  // their own, or those of a branch they manage - plus a parent that organises
  // sub-departments (picking it means "all of them"), with each sub-department
  // listed beneath its parent. See lib/departments/departmentTree.ts.
  const departmentFilterOptions = useMemo(() => {
    const offered = courseFilter === "all"
      ? activeDepartments
      : (() => {
        const offeringIds = new Set(departmentsOfferingCourse(departments, courses, courseFilter).map((d) => d.id));
        return activeDepartments.filter((d) => offeringIds.has(d.id));
      })();
    return buildDepartmentFilterOptions(offered, departments, sectionDepartments);
  }, [courseFilter, activeDepartments, departments, courses, sectionDepartments]);

  // A feeder department teaches the shared first year for several branches at
  // once (Basic Science - Chemistry runs CSE and CSBS). Those are its Core
  // Departments - for a parent, the ones its sub-departments run - and picking
  // one narrows the list to the students filed under it. Offered only when
  // there are any.
  const coreDepartmentOptions = useMemo(
    () => buildCoreDepartmentOptions(departments, deptFilter === "all" ? [] : [deptFilter], sectionDepartments),
    [deptFilter, departments, sectionDepartments]
  );
  const coreDeptValue = coreDepartmentOptions.includes(coreDeptFilter) ? coreDeptFilter : "all";

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

  // The draft as the exact filter set a request would carry.
  const draftFilters = useMemo<StudentListFilters>(() => ({
    search: search.trim().toLowerCase(),
    department: deptFilter,
    coreDepartment: coreDeptValue,
    // "All years" for a department means the years it actually teaches - the
    // same list the Year dropdown offers. Without this, picking a branch that
    // teaches years 2-4 also returned the 1st years its feeder department holds
    // for it, because a department filter matches Core Department too.
    years: deptFilter === "all" ? "" : yearFilterOptions.join(","),
    course: courseFilter,
    year: yearFilter,
    studentType: studentTypeFilter,
    rollFrom: rollFrom.trim(),
    rollTo: rollTo.trim(),
  }), [search, deptFilter, coreDeptValue, yearFilterOptions, courseFilter, yearFilter, studentTypeFilter, rollFrom, rollTo]);

  // True once a list is on screen and the filter bar has been edited since -
  // the table still shows the previous Load's results until Load is pressed.
  const filtersDirty = appliedFilters !== null
    && (Object.keys(draftFilters) as (keyof StudentListFilters)[]).some((k) => draftFilters[k] !== appliedFilters[k]);

  // Whether the list on screen was narrowed by any filter at all.
  const appliedIsFiltered = appliedFilters !== null && filtersToParams(appliedFilters).size > 0;

  // The only thing that reads the student list from the filter bar: freezes the
  // draft into the applied snapshot and goes back to page 1. A fresh object
  // every press, so pressing Load again with unchanged filters is a Refresh.
  function handleLoad() {
    setAppliedFilters({ ...draftFilters });
    setPage(1);
  }

  function onCourseFilterChange(value: string) {
    const nextDeptOptions = value === "all"
      ? activeDepartments
      : activeDepartments.filter((d) => new Set(departmentsOfferingCourse(departments, courses, value).map((o) => o.id)).has(d.id));
    const deptStillValid = deptFilter === "all" || nextDeptOptions.some((d) => d.name === deptFilter);
    const nextDept = deptStillValid ? deptFilter : "all";
    if (!deptStillValid) { setDeptFilter("all"); setCoreDeptFilter("all"); }
    const nextYearOptions = nextDept === "all"
      ? yearOptionsForCourse(courses, value === "all" ? undefined : value, years)
      : yearOptionsForDepartment(departments, courses, nextDept, value === "all" ? "" : value, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setCourseFilter(value);
  }

  function onDeptFilterChange(value: string) {
    const nextYearOptions = value === "all"
      ? yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years)
      : yearOptionsForDepartment(departments, courses, value, courseFilter === "all" ? "" : courseFilter, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setCoreDeptFilter("all");
    setDeptFilter(value);
  }

  function onYearFilterChange(value: string) {
    setYearFilter(value);
  }

  function onStudentTypeFilterChange(value: string) {
    setStudentTypeFilter(value);
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
    // "Matching" means matching the list on screen - the applied snapshot, not
    // whatever has since been typed into the filter bar.
    if (!appliedFilters) return;
    setIsSelectingAll(true);
    try {
      const params = filtersToParams(appliedFilters);
      params.set("idsOnly", "1");
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

  function openAdd() {
    setEditTarget(null);
    setAddOpen(true);
  }

  function openEdit(s: StudentListItem) {
    setEditTarget(s);
    setAddOpen(true);
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
    let failedTotal = 0;
    try {
      for (let i = 0; i < selectedIds.length; i += BULK_DELETE_CHUNK_SIZE) {
        const chunk = selectedIds.slice(i, i + BULK_DELETE_CHUNK_SIZE);
        const res = await fetch("/api/college/students/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentIds: chunk }),
        });
        const json = await res.json() as { deletedCount?: number; skipped?: string[]; failed?: string[]; error?: string };
        if (!res.ok) {
          toast({ variant: "destructive", title: json.error ?? "Failed to remove some students" });
          break;
        }
        deletedTotal += json.deletedCount ?? 0;
        skippedTotal += json.skipped?.length ?? 0;
        failedTotal += json.failed?.length ?? 0;
        setBulkProgress({ done: Math.min(i + chunk.length, selectedIds.length), total: selectedIds.length });
      }
      if (deletedTotal > 0) {
        toast({
          variant: "success",
          title: `${deletedTotal} student${deletedTotal === 1 ? "" : "s"} removed${skippedTotal ? ` (${skippedTotal} already gone)` : ""}`,
        });
      }
      if (failedTotal > 0) {
        toast({ variant: "destructive", title: `${failedTotal} student${failedTotal === 1 ? "" : "s"} could not be removed - please try again` });
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

  // The office types the password (it is never generated). It goes to the server,
  // which hands it to Firebase Auth - nothing stores or shows it again.
  const [passwordDialog, setPasswordDialog] = useState<
    | { kind: "single"; student: StudentListItem }
    | { kind: "bulk" }
    | null
  >(null);

  function handleCreateOrResetLogin(s: StudentListItem) {
    setPasswordDialog({ kind: "single", student: s });
  }

  async function submitSinglePassword(s: StudentListItem, password: string): Promise<string | null> {
    const isReset = !!s.uid;
    const url = isReset
      ? `/api/college/students/${s.id}/reset-login-password`
      : `/api/college/students/${s.id}/create-login`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; alreadyExisted?: boolean };
      if (!res.ok || !json.ok) return json.error ?? "Failed to update login";
      toast({
        variant: "success",
        title: isReset
          ? `Password updated for ${s.name}`
          : json.alreadyExisted ? `${s.name} already has a login` : `Login created for ${s.name}`,
      });
      if (!isReset) void loadStudents();
      return null;
    } catch {
      return "Network error - please try again";
    }
  }

  const [isBulkCreatingLogins, setIsBulkCreatingLogins] = useState(false);

  async function submitBulkPassword(password: string): Promise<string | null> {
    if (selectedIds.length === 0) return "Select at least one student";
    setIsBulkCreatingLogins(true);
    try {
      const res = await fetch("/api/college/students/bulk-create-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: selectedIds, password }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        created?: { id: string }[];
        skipped?: { id: string; reason: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) return json.error ?? "Failed to create logins";
      const createdCount = json.created?.length ?? 0;
      const skipped = json.skipped ?? [];
      toast({
        variant: "success",
        title: `${createdCount} login${createdCount === 1 ? "" : "s"} created${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
      });
      if (skipped.length > 0) {
        const nameById = new Map(students.map((st) => [st.id, st.name]));
        toast({
          variant: "destructive",
          title: "Some students were skipped",
          description: skipped.slice(0, 5).map((sk) => `${nameById.get(sk.id) ?? sk.id}: ${sk.reason}`).join("; ") + (skipped.length > 5 ? `; and ${skipped.length - 5} more` : ""),
        });
      }
      setSelected({});
      void loadStudents();
      return null;
    } catch {
      return "Network error - please try again";
    } finally {
      setIsBulkCreatingLogins(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description={
          activeTab === "strength"
            ? "Live student counts by department, year and section - generated from the student records"
            : activeTab === "promotion"
            ? "Move a cohort to the next year"
            : activeTab === "graduates"
            ? "Every student who has completed their programme"
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StudentsViewTabs tabs={STUDENT_TABS} value={activeTab} onChange={setActiveTab} />
            {activeTab === "roster" && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setExportOpen(true)}>
                  <Download className="h-4 w-4 mr-2" />Export
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/college-office/students/import"><Upload className="h-4 w-4 mr-2" />Import</Link>
                </Button>
                <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Student</Button>
              </div>
            )}
          </div>
        }
      />

      {activeTab === "strength" ? (
        <StudentStrengthDashboard />
      ) : activeTab === "promotion" ? (
        <StudentPromotionsPanel showHeader={false} />
      ) : activeTab === "graduates" ? (
        <GraduatedStudentsView showHeader={false} studentDetailHref={(id) => withListBack(`/college-office/students/${id}`, listUrl, LIST_PATH)} />
      ) : (
        <>
      {/* Summary */}
      {appliedFilters && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span><strong className="text-foreground">{total}</strong> students {appliedIsFiltered ? "match" : "total"}</span>
        </div>
      )}

      {/* Filters - editing any of these reads nothing; Load applies them. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLoad(); }}
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
            {departmentFilterOptions.map((o) => (
              <SelectItem key={o.department.id} value={o.department.name} className={o.depth === 1 ? "pl-8" : undefined}>
                {o.department.name}{o.container ? " (all sub-departments)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {coreDepartmentOptions.length > 0 && (
          <Select value={coreDeptValue} onValueChange={setCoreDeptFilter}>
            <SelectTrigger className="sm:w-56"><SelectValue placeholder="All core departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All core departments</SelectItem>
              {coreDepartmentOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
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
        <Button onClick={handleLoad} loading={isFetching}>
          <Search className="h-4 w-4 mr-2" />{appliedFilters ? "Reload" : "Load"}
        </Button>
      </div>

      {/* Roll number range - one more filter, applied by Load like the rest.
          Inclusive, compared upper-cased; leave one end blank for "from here
          on" / "up to here". */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">Roll no. range:</span>
        <Input
          placeholder="From roll no."
          value={rollFrom}
          onChange={(e) => setRollFrom(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleLoad(); }}
          className="h-9 w-40"
          autoComplete="off"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          placeholder="To roll no."
          value={rollTo}
          onChange={(e) => setRollTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleLoad(); }}
          className="h-9 w-40"
          autoComplete="off"
        />
        {(rollFrom || rollTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setRollFrom(""); setRollTo(""); }}>Clear range</Button>
        )}
        {filtersDirty && (
          <span className="text-xs text-amber-600 sm:ml-auto">Filters changed - press Reload to apply.</span>
        )}
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
            <Button variant="outline" size="sm" onClick={() => setPasswordDialog({ kind: "bulk" })} loading={isBulkCreatingLogins}>
              <KeyRound className="h-4 w-4 mr-2" />Create Logins
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" />Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {!appliedFilters ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">Set any filters (or none, for everyone), then load the student list.</p>
          <Button onClick={handleLoad}>Load Students</Button>
        </div>
      ) : isLoading || (isFetching && students.length === 0 && total === 0) ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : students.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">{appliedIsFiltered ? "No students match your filters" : "No students yet"}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {appliedIsFiltered ? "Try clearing the search or filters, then press Reload." : "Add a student manually or import a roster to get started."}
          </p>
          {!appliedIsFiltered && <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Student</Button>}
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
                        className={SELECT_CHECKBOX_CLASS}
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
                      onClick={() => router.push(withListBack(`/college-office/students/${s.id}`, listUrl, LIST_PATH))}
                      className={`border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors ${i % 2 === 0 ? "" : "bg-muted/20"}`}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={!!selected[s.id]}
                          onCheckedChange={(checked) => toggleSelectOne(s.id, checked)}
                          aria-label={`Select ${s.name}`}
                          className={SELECT_CHECKBOX_CLASS}
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
                          onClick={(e) => { e.stopPropagation(); router.push(withListBack(`/college-office/students/${s.id}/documents`, listUrl, LIST_PATH)); }}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Documents"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCreateOrResetLogin(s); }}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title={s.uid ? "Reset login password" : "Create login"}
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
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
        </>
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

      {/* ── Add / Edit Student dialog ── */}
      <StudentFormDialog
        open={addOpen}
        onOpenChange={(o) => { setAddOpen(o); if (!o) setEditTarget(null); }}
        student={editTarget} rollEditable
        onSaved={() => { setAddOpen(false); setEditTarget(null); void loadStudents(); }}
      />

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

      <StudentPasswordDialog
        open={passwordDialog !== null}
        onClose={() => setPasswordDialog(null)}
        title={
          passwordDialog?.kind === "single"
            ? (passwordDialog.student.uid ? `New password for ${passwordDialog.student.name}` : `Create login for ${passwordDialog.student.name}`)
            : `Create logins for ${selectedIds.length} student${selectedIds.length === 1 ? "" : "s"}`
        }
        description={
          passwordDialog?.kind === "single"
            ? (passwordDialog.student.uid
                ? "Set the password this student will sign in with, together with their Roll Number. The old password stops working."
                : "Choose the password this student will sign in with, together with their Roll Number.")
            : "Every selected student gets a login with this same password, signing in with their own Roll Number. They can change it after signing in, or you can reset any one of them later."
        }
        submitLabel={passwordDialog?.kind === "single" && passwordDialog.student.uid ? "Set password" : "Create login"}
        onSubmit={(password) =>
          passwordDialog?.kind === "single" ? submitSinglePassword(passwordDialog.student, password) : submitBulkPassword(password)
        }
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

export default function OfficeStudentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground animate-pulse">Loading students...</div>}>
      <OfficeStudentsContent />
    </Suspense>
  );
}
