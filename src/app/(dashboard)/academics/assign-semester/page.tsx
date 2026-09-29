"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowLeft as ArrowLeftIcon, Search, Layers, CheckSquare, BookOpen, GraduationCap, Info } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, CourseYearTiming, Department, Subject, SubjectSemesterAssignment } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";
import { regulationsForCourseYearByBatch, fedYears } from "@/lib/college/academicStructure";
import { currentAcademicStartYear } from "@/lib/college/academicSession";
import { managerTeachingYears } from "@/lib/departments/managedBranches";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Which of a catalog entry's regulations actually governs `year`, for a
// deep-linked prefill (see the Stage 1 effect below) - same batch-aware
// resolution yearOptions itself filters by, just run once up front instead
// of per-candidate-year, since here the year is already fixed by the link.
// Falls back to the catalog's first regulation for a legacy entry with no
// batch config, so a prefill is never left with an empty Regulation.
function resolveRegulationForYear(item: CourseCatalogItem, year: number): string {
  const regs = regulationsForCourseYearByBatch(
    item.regulationBatches ?? {},
    year,
    currentAcademicStartYear(),
    item.regulations,
  );
  return regs[0] ?? item.regulations?.[0] ?? "";
}

// A master subject (courseId + regulation, department-independent - see its
// own doc-comment in types/teaching.ts and /api/college/subjects GET's own)
// can be mapped into a DIFFERENT semester by different departments - Physics
// might be Semester 1 for CSE and Semester 2 for ECE - and even into two
// semesters for the SAME department (a year-long/shared subject spanning
// S1+S2). That's a real many-to-many relationship, so it's its own
// collection (SubjectSemesterAssignment, doc id
// `${subjectId}_${departmentId}_${semester}`) rather than a single field on
// Subject.
//
// Picker order: Regulation -> Course -> Department -> Year -> Semester.
// Regulation and Course are picked at the CATALOG level first (mirrors
// Master Subjects' own Regulation-first picker) - the Available Subjects they
// resolve is genuinely department-independent, so which department eventually
// receives the "copy to semester" doesn't matter until that step. Only once
// Department is chosen does this page need one department's own Course doc
// (`selectedCourse`, resolved - not picked again - from `courses`, that
// department's own courses/route.ts result matched against the already-
// chosen catalogId) for Year/Semester, which ARE department-specific
// (Course-Year Timings, managerTeachingYears/fedYears).
//
// Sub-department support: when a top-level department has children
// (e.g. Basic Science → BS-Chemistry, BS-Mathematics), the picker
// shows those children under the parent so subjects can be assigned
// to the specific sub-department, not just the parent.
export default function AssignToSemesterPage() {
  return (
    <Suspense fallback={null}>
      <AssignToSemesterPageInner />
    </Suspense>
  );
}

function AssignToSemesterPageInner() {
  const searchParams = useSearchParams();
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignments, setAssignments] = useState<SubjectSemesterAssignment[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  // Picked in this order: Regulation -> Course (catalog-level, hence
  // selectedCatalogId not selectedCourseId) -> Department -> Year -> Semester.
  // selectedCourse itself (the department's own Course doc) is resolved
  // below, not picked directly - see this file's own top doc-comment.
  const [selectedRegulation, setSelectedRegulation] = useState("");
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);

  // Pagination
  const [masterPage, setMasterPage] = useState(1);
  const masterPageSize = 10;
  const [assignPage, setAssignPage] = useState(1);
  const assignPageSize = 10;

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: Department[] }>)
      .then((d) => {
        const all = d.departments ?? [];
        setAllDepartments(all);
        const topLevel = all.filter((dept) => !dept.parentDepartmentId);
        setDepartments(topLevel.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));

    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => { /* non-critical - regulation list just stays empty */ });
  }, []);

  // Deep-link prefill from another page's "Sem N: K subjects - tap to fill"
  // link (principal/departments/[id]/page.tsx's per-year status badges) -
  // ?catalogId=&departmentId=&year=&semester= walks the same Regulation ->
  // Catalog -> Department -> Year -> Semester chain a person would click
  // through by hand. Read once on mount (a deep link is a one-shot
  // instruction, not something that should re-fire if this component
  // re-renders) and consumed in two stages below, since Department requires
  // an async courses fetch to settle before Year/Semester can be set.
  const prefillRef = useRef<{ catalogId: string; departmentId: string; year: string; semester: string | null } | null>(null);
  const [prefillPending, setPrefillPending] = useState(false);
  useEffect(() => {
    const catalogId = searchParams.get("catalogId");
    const departmentId = searchParams.get("departmentId");
    const year = searchParams.get("year");
    if (catalogId && departmentId && year) {
      prefillRef.current = { catalogId, departmentId, year, semester: searchParams.get("semester") };
      setPrefillPending(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catalogById = useMemo(() => new Map(catalogItems.map((c) => [c.id, c])), [catalogItems]);

  // Regulation options (top-level, picked first): every regulation ANY
  // active catalog course has ever been configured with, flattened and
  // deduped - a college may run more than one programme/regulation, and
  // which one governs is exactly what this field exists to pin down before
  // Course even narrows.
  const topLevelRegulationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of catalogItems) for (const r of c.regulations ?? []) set.add(r);
    return Array.from(set).sort();
  }, [catalogItems]);

  // Course options (catalog-level, picked second): every catalog entry that
  // actually offers the selected Regulation. This is a CourseCatalogItem
  // pick, not a specific department's Course doc - Department (and which of
  // its Course docs that resolves to) comes after.
  const catalogOptions = useMemo(
    () => catalogItems.filter((c) => (c.regulations ?? []).includes(selectedRegulation)).sort((a, b) => a.name.localeCompare(b.name)),
    [catalogItems, selectedRegulation]
  );
  const selectedCatalogItem = useMemo(() => catalogById.get(selectedCatalogId) ?? null, [catalogById, selectedCatalogId]);

  const selectedDepartment = useMemo(
    () => allDepartments.find((d) => d.id === selectedDepartmentId) ?? null,
    [allDepartments, selectedDepartmentId]
  );

  // This DEPARTMENT's own Course doc for the already-chosen catalog entry -
  // resolved once Department is picked, not chosen directly (Course was
  // already fixed at the catalog level above). `courses` is this one
  // department's own list (loadCourses, sub-department-aware), but for a
  // department fed by a shared-year manager (e.g. CSE's Year 1 run by Basic
  // Science) that list legitimately contains TWO docs for the same
  // catalogId - the manager's own and this department's own (see
  // /api/college/courses's own "legitimate feeder-department case" comment,
  // which deliberately shows both rather than collapsing them). Matching by
  // catalogId alone picked whichever happened to come first and could
  // resolve to the MANAGER's doc even when this department has its own -
  // e.g. CSE's own Year 2/3/4 timings/instances live under CSE's own course,
  // never Basic Science's (which only ever has Year 1). Prefer this
  // department's own doc; fall back to any catalog match only for a
  // department that genuinely has none of its own (fully fed).
  const selectedCourse = useMemo(() => {
    const matches = courses.filter((c) => c.catalogId === selectedCatalogId);
    return matches.find((c) => c.departmentId === selectedDepartmentId) ?? matches[0] ?? null;
  }, [courses, selectedCatalogId, selectedDepartmentId]);

  // Prefill stage 1: once the catalog is loaded, resolve Regulation from the
  // linked year/catalog and kick off Department (selectDepartment fetches
  // that department's own courses - selectedCourse above can't resolve
  // until that lands, which is what stage 2 below waits on).
  useEffect(() => {
    if (!prefillPending || catalogItems.length === 0) return;
    const p = prefillRef.current;
    const item = p ? catalogItems.find((c) => c.id === p.catalogId) : null;
    if (!p || !item) { setPrefillPending(false); return; }
    setSelectedRegulation(resolveRegulationForYear(item, Number(p.year)));
    setSelectedCatalogId(p.catalogId);
    selectDepartment(p.departmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPending, catalogItems]);

  // Prefill stage 2: once this department's own Course doc has resolved,
  // finish with Year + Semester (selectYear needs selectedCourse to fire its
  // own subjects/timings fetch - see that function's own body).
  useEffect(() => {
    if (!prefillPending || !selectedCourse) return;
    const p = prefillRef.current;
    if (!p) { setPrefillPending(false); return; }
    selectYear(p.year);
    if (p.semester) setSelectedSemester(Number(p.semester));
    setPrefillPending(false);
    prefillRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPending, selectedCourse]);

  // Build parent → children map for the department tree
  const childrenOf = useMemo(() => {
    const map = new Map<string, Department[]>();
    for (const d of allDepartments) {
      if (d.parentDepartmentId) {
        const list = map.get(d.parentDepartmentId) ?? [];
        list.push(d);
        map.set(d.parentDepartmentId, list);
      }
    }
    return map;
  }, [allDepartments]);

  // Whether the currently selected department is a child (sub-department)
  const isSubDept = selectedDepartmentId && allDepartments.some((d) => d.id === selectedDepartmentId && d.parentDepartmentId);

  // Narrowed to the years this exact department actually teaches this
  // course, not just "1..durationYears" - a shared-first-year department
  // (e.g. Basic Science, assignedYears [1]) never teaches Year 2-4, and a
  // branch it feeds (e.g. CSE) never teaches the fed Year 1, even though
  // both structurally belong to a 4-year course. managerTeachingYears
  // resolves the department's own (or inherited-from-parent) configured
  // years first; only when that's genuinely unconfigured does fedYears
  // subtract whatever a feeder has claimed - the same precedence
  // academicStructure.ts's own doc-comments describe (assignedYears is
  // supposed to already exclude fed years; fedYears only closes the gap
  // when a department was left unconfigured). A college with no
  // shared-first-year setup at all sees no change - both resolve empty and
  // the fallback returns every year unfiltered, same as before this existed.
  // Narrowed twice: first to the years this exact department actually
  // teaches this course (assignedYears/fedYears, as before), then to the
  // years the already-chosen Regulation's own batch coverage actually
  // governs - the same batch-aware check Sections and Subjects already
  // enforce, just run per-candidate-year here since Regulation is now fixed
  // BEFORE Year is even offered (rather than the old Year-first flow, which
  // resolved which regulation(s) covered one already-chosen Year). A
  // catalog entry with no regulationBatches configured keeps every
  // teachable year - regulationsForCourseYearByBatch's own
  // backward-compatibility fallback already makes it resolve to every one
  // of the course's regulations for an unconfigured year, so selectedRegulation
  // (always one of them) always matches.
  const yearOptions = useMemo(() => {
    if (!selectedCourse || !selectedDepartment) return [];
    const courseYears = Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1);
    const catalogId = selectedCourse.catalogId;
    const assigned = managerTeachingYears(allDepartments, selectedDepartment, catalogId);
    const teachableYears = assigned.length > 0
      ? courseYears.filter((y) => assigned.includes(y))
      : courseYears.filter((y) => !new Set(fedYears(selectedDepartment, allDepartments, catalogId)).has(y));
    if (!selectedCatalogItem) return teachableYears;
    return teachableYears.filter((y) =>
      regulationsForCourseYearByBatch(
        selectedCatalogItem.regulationBatches ?? {},
        y,
        currentAcademicStartYear(),
        selectedCatalogItem.regulations,
      ).includes(selectedRegulation)
    );
  }, [selectedCourse, selectedDepartment, allDepartments, selectedCatalogItem, selectedRegulation]);

  const semesterOptions = useMemo(() => {
    if (!selectedYear) return [];
    const yearNum = Number(selectedYear);
    const yearTiming = timings.find((t) => t.year === yearNum);
    const nums = new Set<number>();
    for (const s of yearTiming?.semesters ?? []) nums.add(s.semester);
    for (const a of assignments) {
      if (a.year === yearNum && a.semester != null) nums.add(a.semester);
    }
    if (selectedSemester != null) nums.add(selectedSemester);
    const paramSem = searchParams.get("semester");
    if (paramSem) nums.add(Number(paramSem));

    return Array.from(nums).sort((a, b) => a - b);
  }, [timings, selectedYear, assignments, selectedSemester, searchParams]);
  const effectiveSemester = semesterOptions.length === 0
    ? null
    : selectedSemester != null && semesterOptions.includes(selectedSemester)
      ? selectedSemester
      : semesterOptions[0];

  // Passes the SELECTED department's own id straight through, whether it's a
  // parent or a sub-department - never collapsed to the parent's id first.
  // /api/college/courses already resolves a sub-department correctly on its
  // own (getRelatedDepartmentIds expands the child's id to [child, parent],
  // then filterSubDepartmentCourses settles the combined list: the child's
  // own customised copies stand in for the parent's, and anything the child
  // has excluded via excludedCourseCatalogIds is dropped) - that settling
  // logic only runs when the request's departmentId IS the sub-department,
  // per that route's own targetSubDepartment check. Pre-collapsing to the
  // parent's id here (the previous behavior) skipped it entirely, so a
  // sub-department with its own customized course, or one it had excluded,
  // silently showed the parent's raw list instead - identical output for a
  // sub-department that has never customized anything, since that's exactly
  // what an unfiltered inherited list already looks like.
  // Guards against an out-of-order response: switching Department (or a
  // fast Course->Department->Year click-through) fires a new fetch before
  // the previous one lands, and network order isn't call order - a stale
  // response landing last previously overwrote `courses` with the WRONG
  // department's list, which then fed a wrong/empty `selectedCourse` and
  // made a genuinely-configured year report "no semesters configured".
  // Only the most recently STARTED call's response is ever applied.
  const coursesRequestIdRef = useRef(0);
  const loadCourses = useCallback(async (departmentId: string) => {
    const requestId = ++coursesRequestIdRef.current;
    setIsLoadingCourses(true);
    try {
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
      const data = await res.json() as { courses?: Course[] };
      if (requestId !== coursesRequestIdRef.current) return;
      setCourses((data.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      if (requestId !== coursesRequestIdRef.current) return;
      toast({ variant: "destructive", title: "Failed to load courses" });
    } finally {
      if (requestId === coursesRequestIdRef.current) setIsLoadingCourses(false);
    }
  }, []);

  // Master Collection = every subject for this catalog course+year
  // (department-independent). Semester panel = this DEPARTMENT's own
  // mappings for that catalog+year, from the junction collection.
  // Same out-of-order-response guard as loadCourses above - this is the
  // exact function the reported bug traced back to: clicking Year 2 then
  // Year 3 quickly could let Year 2's slower response land AFTER Year 3's
  // and overwrite `timings`/`subjects`/`assignments` with Year 2's data
  // while `selectedYear` had already moved to "3", so semesterOptions
  // (which looks up `timings.find(t => t.year === 3)`) found nothing and
  // reported "No semesters configured" for a year that genuinely had them.
  const subjectsAndTimingsRequestIdRef = useRef(0);
  const loadSubjectsAndTimings = useCallback(async (course: Course, departmentId: string, year: string) => {
    const requestId = ++subjectsAndTimingsRequestIdRef.current;
    setIsLoadingSubjects(true);
    try {
      const catalogId = course.catalogId ?? "";
      // Master subjects are course+regulation scoped only (no ordinal `year`
      // field - see types/teaching.ts's own Subject.year comment), so the
      // GET route never reads a `year` param; `year` is still this
      // function's own param (used below for the assignment/instance calls
      // that DO need it - Year is what a department's mapping is keyed by).
      //
      // Queried by catalogId, not this department's own course.id - the
      // Master Collection is genuinely department-independent (see this
      // function's own doc-comment above), shared by every department that
      // teaches this catalog course, not just whichever one's Course doc a
      // given subject happens to be filed under (see /api/college/subjects
      // GET's own doc-comment). Falls back to course.id only for the rare
      // legacy Course doc with no catalogId set.
       const [subjectsRes, timingsRes, assignmentsRes] = await Promise.all([
        fetch(catalogId
          ? `/api/college/subjects?catalogId=${encodeURIComponent(catalogId)}`
          : `/api/college/subjects?courseId=${encodeURIComponent(course.id)}`),
        fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(course.id)}`),
        fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(course.id)}&departmentId=${encodeURIComponent(departmentId)}`),
      ]);
      const subjectsData = await subjectsRes.json() as { subjects?: Subject[] };
      const timingsData = await timingsRes.json() as { timings?: CourseYearTiming[] };
      const assignmentsData = assignmentsRes ? await assignmentsRes.json() as { assignments?: SubjectSemesterAssignment[] } : { assignments: [] };
      if (requestId !== subjectsAndTimingsRequestIdRef.current) return;
      setSubjects(subjectsData.subjects ?? []);
      setTimings((timingsData.timings ?? []).filter((t) => t.year === Number(year)));
      setAssignments(assignmentsData.assignments ?? []);
    } catch {
      if (requestId !== subjectsAndTimingsRequestIdRef.current) return;
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      if (requestId === subjectsAndTimingsRequestIdRef.current) setIsLoadingSubjects(false);
    }
  }, []);

  function selectRegulation(regulation: string) {
    setSelectedRegulation(regulation);
    setSelectedCatalogId("");
    setSelectedDepartmentId("");
    setSelectedYear("");
    setSelectedSemester(null);
    setCourses([]);
    setSubjects([]);
    setAssignments([]);
    setTimings([]);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
  }

  function selectCatalog(catalogId: string) {
    setSelectedCatalogId(catalogId);
    setSelectedDepartmentId("");
    setSelectedYear("");
    setSelectedSemester(null);
    setCourses([]);
    setSubjects([]);
    setAssignments([]);
    setTimings([]);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
  }

  function selectDepartment(departmentId: string) {
    setSelectedDepartmentId(departmentId);
    setSelectedYear("");
    setSelectedSemester(null);
    setSubjects([]);
    setAssignments([]);
    setTimings([]);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
    void loadCourses(departmentId);
  }

  function selectYear(year: string) {
    setSelectedYear(year);
    setSelectedSemester(null);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
    if (selectedCourse) void loadSubjectsAndTimings(selectedCourse, selectedDepartmentId, year);
  }

  async function setSubjectSemester(subject: Subject, semester: number | null, removeFromSemester?: number, removeFromDepartmentId?: string) {
    if (!selectedCourse || !selectedDepartment) return;
    setSavingId(subject.id);
    setAssignPage(1);
    try {
      if (semester != null) {
        const res = await fetch("/api/college/subject-semester-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: subject.id,
            subjectName: subject.name,
            subjectCode: subject.code,
            catalogId: selectedCourse.catalogId,
            year: Number(selectedYear),
            departmentId: selectedDepartment.id,
            departmentName: selectedDepartment.name,
            courseId: selectedCourse.id,
            semester,
          }),
        });
        const json = await res.json() as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to assign subject");
      } else {
        // The list can show a sub-department's own instance while the
        // PARENT department is selected (GET merges them in - see this
        // file's own top doc-comment on sub-department support), so the
        // instance being removed may belong to a different department than
        // whatever's currently selected. removeFromDepartmentId (the row's
        // own a.departmentId) must be used here instead of
        // selectedDepartment.id - which is always the parent in that case -
        // or this computes a DELETE for a doc that doesn't exist: Firestore
        // no-ops instead of erroring, so it looked like a successful
        // removal that silently didn't remove anything.
        const targetDepartmentId = removeFromDepartmentId ?? selectedDepartment.id;
        const res = await fetch(
          `/api/college/subject-semester-assignments?subjectId=${encodeURIComponent(subject.id)}&departmentId=${encodeURIComponent(targetDepartmentId)}&semester=${removeFromSemester ?? effectiveSemester}`,
          { method: "DELETE" }
        );
        const json = await res.json() as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to remove subject");
      }
      if (selectedCourse) await loadSubjectsAndTimings(selectedCourse, selectedDepartment.id, selectedYear);
      toast({ variant: "success", title: semester != null ? `Added to Semester ${semester}` : "Removed from semester" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update subject" });
    } finally {
      setSavingId(null);
    }
  }

  async function handleBulkAssign() {
    if (!selectedCourse || !selectedDepartment || effectiveSemester == null || selectedSubjectIds.length === 0) return;
    setIsBulkAssigning(true);
    try {
      const res = await fetch("/api/college/subject-semester-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectIds: selectedSubjectIds,
          departmentId: selectedDepartment.id,
          departmentName: selectedDepartment.name,
          semester: effectiveSemester,
          year: Number(selectedYear),
          courseId: selectedCourse.id,
        }),
      });
      const json = await res.json() as { assignedCount?: number; failed?: { subjectId: string; error: string }[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to assign subjects");
      setSelectedSubjectIds([]);
      const failed = json.failed ?? [];
      if (failed.length > 0) {
        // Every subject the backend couldn't instantiate (duplicate,
        // department-scope violation, etc.) - shown by name, not just id, so
        // this is actionable rather than a bare error code. Previously
        // dropped entirely: only assignedCount was ever read, so a partial
        // failure looked identical to full success.
        const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));
        const shown = failed.slice(0, 3).map((f) => `${subjectNameById.get(f.subjectId) ?? f.subjectId}: ${f.error}`);
        toast({
          variant: "destructive",
          title: `${json.assignedCount ?? 0} assigned, ${failed.length} failed`,
          description: shown.join(" · ") + (failed.length > 3 ? ` (+${failed.length - 3} more)` : ""),
        });
      } else {
        toast({ variant: "success", title: `${json.assignedCount ?? selectedSubjectIds.length} subjects instantiated for Semester ${effectiveSemester}` });
      }
      await loadSubjectsAndTimings(selectedCourse, selectedDepartment.id, selectedYear);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Bulk assign failed" });
    } finally {
      setIsBulkAssigning(false);
    }
  }

  // Scoped to the semester tab currently open - a subject already instanced
  // in Semester 1 must still be offered here while viewing Semester 2 (a
  // year-long subject can be a live instance in both), not just once ever.
  const assignedSubjectIds = useMemo(
    () => new Set(assignments.filter((a) => a.semester === effectiveSemester).map((a) => a.subjectId)),
    [assignments, effectiveSemester]
  );
  const subjectsInRegulation = useMemo(
    () => (selectedRegulation ? subjects.filter((s) => !s.regulation || s.regulation === selectedRegulation) : subjects),
    [subjects, selectedRegulation]
  );
  const masterPool = useMemo(
    () => subjectsInRegulation.filter((s) => !assignedSubjectIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [subjectsInRegulation, assignedSubjectIds]
  );
  const searchedMasterPool = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return masterPool;
    return masterPool.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [masterPool, searchText]);
  const semesterAssignments = useMemo(
    () => assignments.filter((a) => a.semester === effectiveSemester).sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
    [assignments, effectiveSemester]
  );

  // Paginated slices
  const masterTotalPages = Math.max(1, Math.ceil(searchedMasterPool.length / masterPageSize));
  const paginatedMasterPool = searchedMasterPool.slice((masterPage - 1) * masterPageSize, masterPage * masterPageSize);
  const assignTotalPages = Math.max(1, Math.ceil(semesterAssignments.length / assignPageSize));
  const paginatedAssignments = semesterAssignments.slice((assignPage - 1) * assignPageSize, assignPage * assignPageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Assign to Semester" description="Map master subjects into a specific semester, per department" />

      {isLoading ? (
        <div className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
      ) : departments.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No departments have been set up for this college yet.
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5">
                <Label htmlFor="assign-regulation" className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0" aria-hidden="true">1</span>
                  Regulation
                </Label>
                <Select value={selectedRegulation} onValueChange={selectRegulation}>
                  <SelectTrigger id="assign-regulation" aria-label="Select regulation">
                    <SelectValue placeholder="Select regulation" />
                  </SelectTrigger>
                  <SelectContent>
                    {topLevelRegulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assign-course" className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0" aria-hidden="true">2</span>
                  Course
                </Label>
                <Select value={selectedCatalogId} onValueChange={selectCatalog} disabled={!selectedRegulation}>
                  <SelectTrigger id="assign-course" aria-label="Select course">
                    <SelectValue placeholder={!selectedRegulation ? "Select a regulation first" : "Select course"} />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!selectedRegulation && <p className="text-[11px] text-muted-foreground">Select a regulation first.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assign-department" className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0" aria-hidden="true">3</span>
                  Department
                </Label>
                <Select value={selectedDepartmentId} onValueChange={selectDepartment} disabled={!selectedCatalogId}>
                  <SelectTrigger id="assign-department" aria-label="Select department">
                    <SelectValue placeholder={!selectedCatalogId ? "Select a course first" : "Select department"} />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.flatMap((d) => [
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>,
                      ...(childrenOf.get(d.id) ?? []).map((child) => (
                        <SelectItem key={child.id} value={child.id} className="pl-6">
                          {child.name}
                        </SelectItem>
                      )),
                    ])}
                  </SelectContent>
                </Select>
                {!selectedCatalogId && <p className="text-[11px] text-muted-foreground">Select a course first.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assign-year" className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0" aria-hidden="true">4</span>
                  Year
                </Label>
                <Select value={selectedYear} onValueChange={selectYear} disabled={!selectedCourse || isLoadingCourses}>
                  <SelectTrigger id="assign-year" aria-label="Select year">
                    <SelectValue placeholder={isLoadingCourses ? "Loading…" : !selectedDepartmentId ? "Select a department first" : "Select year"} />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!selectedCourse && selectedDepartmentId && !isLoadingCourses && (
                  <p className="text-[11px] text-amber-600">This department doesn&apos;t teach this course.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assign-semester" className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0" aria-hidden="true">5</span>
                  Semester
                </Label>
                {selectedYear && semesterOptions.length === 0 ? (
                  <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3">
                    <span className="text-xs text-muted-foreground">No semesters configured for this year</span>
                  </div>
                ) : (
                  <Select
                    value={effectiveSemester != null ? String(effectiveSemester) : ""}
                    onValueChange={(v) => setSelectedSemester(Number(v))}
                    disabled={!selectedYear || semesterOptions.length === 0}
                  >
                    <SelectTrigger id="assign-semester" aria-label="Select semester">
                      <SelectValue placeholder={!selectedYear ? "Select a year first" : "Select semester"} />
                    </SelectTrigger>
                    <SelectContent>
                      {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {!selectedYear && <p className="text-[11px] text-muted-foreground">Select a year first.</p>}
              </div>
            </CardContent>
          </Card>

          {selectedDepartment && !isLoadingCourses && courses.length === 0 && (
            <p className="text-sm text-muted-foreground px-1">
              No courses have been set up for {selectedDepartment.name} yet.
            </p>
          )}

          {selectedDepartment && !isLoadingCourses && courses.length > 0 && !selectedCourse && (
            <p className="text-sm text-muted-foreground px-1">
              {selectedDepartment.name} doesn&apos;t teach {selectedCatalogItem?.name ?? "this course"} yet.
            </p>
          )}

          {selectedCourse && selectedDepartment && !selectedYear && yearOptions.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {selectedDepartment.name} isn&apos;t scoped to teach any year of {selectedCatalogItem?.name ?? "this course"} under {selectedRegulation}.
            </div>
          )}

          {selectedYear && semesterOptions.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              This course-year has no semesters configured yet. Set them up in Course-Year Timings first.
            </div>
          )}

          {selectedYear && effectiveSemester != null && (
            isLoadingSubjects ? (
              <div className="grid gap-4 md:grid-cols-2">
                {[1, 2].map((i) => <div key={i} className="h-40 rounded-lg border bg-muted/30 animate-pulse" />)}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="h-4 w-4" aria-hidden="true" />
                        Available Subjects
                      </CardTitle>
                      {selectedSubjectIds.length > 0 && (
                        <Button
                          size="sm"
                          variant="default"
                          loading={isBulkAssigning}
                          onClick={() => void handleBulkAssign()}
                        >
                          <CheckSquare className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                          Assign {selectedSubjectIds.length} to Sem {effectiveSemester}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                          value={searchText}
                          onChange={(e) => setSearchText(e.target.value)}
                          placeholder="Search by name or code…"
                          className="pl-8 h-9"
                        />
                      </div>
                      {paginatedMasterPool.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-9"
                          onClick={() => {
                            const idsOnPage = paginatedMasterPool.map((s) => s.id);
                            const allSelected = idsOnPage.every((id) => selectedSubjectIds.includes(id));
                            if (allSelected) {
                              setSelectedSubjectIds((prev) => prev.filter((id) => !idsOnPage.includes(id)));
                            } else {
                              setSelectedSubjectIds((prev) => Array.from(new Set([...prev, ...idsOnPage])));
                            }
                          }}
                        >
                          {paginatedMasterPool.every((s) => selectedSubjectIds.includes(s.id)) ? "Deselect All" : "Select All"}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {masterPool.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        All subjects are already assigned to Semester {effectiveSemester} for {selectedDepartment?.name ?? ""}.
                      </p>
                     ) : paginatedMasterPool.length === 0 ? (
                       <p className="text-sm text-muted-foreground text-center py-6">
                         No subjects match &quot;{searchText}&quot;.
                       </p>
                     ) : (
                       <>
                         {selectedSubjectIds.length === 0 && paginatedMasterPool.length > 0 && (
                           <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground">
                             <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                             Check subjects to select them for bulk assignment to Semester {effectiveSemester}.
                           </div>
                         )}
                         <div className="space-y-2">
                           {paginatedMasterPool.map((s) => {
                             const isChecked = selectedSubjectIds.includes(s.id);
                             return (
                               <div
                                 key={s.id}
                                 className={`flex items-start justify-between gap-3 rounded-md border p-3 transition-colors ${
                                   isChecked ? "bg-muted/40 border-primary/40" : ""
                                 }`}
                               >
                                 <div className="flex items-start gap-2.5 pt-0.5">
                                   <Checkbox
                                     checked={isChecked}
                                     onCheckedChange={(checked) => {
                                       setSelectedSubjectIds((prev) =>
                                         checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                                       );
                                     }}
                                   />
                                   <div className="space-y-1">
                                     <div className="text-sm font-medium leading-snug">
                                       {s.name} <span className="font-mono text-xs text-muted-foreground">({s.code})</span>
                                     </div>
                                     <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                       {s.category && (
                                         <Badge variant="outline" className="text-[11px] py-0">
                                           {s.category === "OTHER" ? s.customCategory || "Other" : s.category}
                                         </Badge>
                                       )}
                                       {s.type && (
                                         <Badge variant="secondary" className="text-[11px] py-0">
                                           {SUBJECT_TYPE_LABELS[s.type] ?? s.type}
                                         </Badge>
                                       )}
                                       {s.credits != null && (
                                         <Badge variant="outline" className="text-[11px] py-0 font-medium">
                                           {s.credits} Credits
                                         </Badge>
                                       )}
                                       {(s.lectureHours != null || s.tutorialHours != null || s.practicalHours != null) && (
                                         <span className="text-[11px] text-muted-foreground">
                                           L:{s.lectureHours ?? 0} T:{s.tutorialHours ?? 0} P:{s.practicalHours ?? 0}
                                         </span>
                                       )}
                                       {s.regulation && (
                                         <Badge variant="secondary" className="text-[11px] py-0">
                                           {s.regulation}
                                         </Badge>
                                       )}
                                     </div>
                                   </div>
                                 </div>
                                 <Button
                                   size="sm"
                                   variant="outline"
                                   className="shrink-0 h-8 text-xs"
                                   loading={savingId === s.id}
                                   onClick={() => void setSubjectSemester(s, effectiveSemester)}
                                 >
                                   Add<ArrowRight className="h-3.5 w-3.5 ml-1.5" aria-hidden="true" />
                                 </Button>
                               </div>
                             );
                           })}
                         </div>
                         <Pagination
                           page={masterPage}
                           pageSize={masterPageSize}
                           total={searchedMasterPool.length}
                           onPageChange={setMasterPage}
                           onPageSizeChange={() => {}}
                           disabled={false}
                         />
                       </>
                     )}
                   </CardContent>
                 </Card>

                 <Card>
                   <CardHeader className="pb-3">
                     <CardTitle className="text-base">
                       {isSubDept
                         ? `Semester ${effectiveSemester} — ${selectedDepartment?.name} (sub-department)`
                         : `Semester ${effectiveSemester} — ${selectedDepartment?.name ?? ""}`}
                     </CardTitle>
                     <p className="text-xs text-muted-foreground">Subjects currently mapped to this semester for this department.</p>
                   </CardHeader>
                   <CardContent>
                     {paginatedAssignments.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No subjects assigned to this semester yet. Select subjects from the left panel and click Add, or use bulk assign.
                      </p>
                    ) : (
                      <>
                      <div className="space-y-2">
                        {paginatedAssignments.map((a) => {
                          const subject = subjects.find((s) => s.id === a.subjectId);
                          return (
                            <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                              <div className="space-y-1">
                                <div className="text-sm font-medium leading-snug">
                                  {a.subjectName} <span className="font-mono text-xs text-muted-foreground">({a.subjectCode})</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                  {(a.category || subject?.category) && (
                                    <Badge variant="outline" className="text-[11px] py-0">
                                      {a.category ?? subject?.category}
                                    </Badge>
                                  )}
                                  {(a.type || subject?.type) && (
                                    <Badge variant="secondary" className="text-[11px] py-0">
                                      {SUBJECT_TYPE_LABELS[a.type ?? subject?.type ?? "THEORY"]}
                                    </Badge>
                                  )}
                                  {(a.credits != null || subject?.credits != null) && (
                                    <Badge variant="outline" className="text-[11px] py-0 font-medium">
                                      {a.credits ?? subject?.credits} Credits
                                    </Badge>
                                  )}
                                  {(a.lectureHours != null || subject?.lectureHours != null) && (
                                    <span className="text-[11px] text-muted-foreground">
                                      L:{a.lectureHours ?? subject?.lectureHours ?? 0} T:{a.tutorialHours ?? subject?.tutorialHours ?? 0} P:{a.practicalHours ?? subject?.practicalHours ?? 0}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="shrink-0 text-destructive hover:text-destructive h-8 text-xs"
                                loading={savingId === a.subjectId}
                                onClick={() => void setSubjectSemester(subject ?? { id: a.subjectId } as Subject, null, a.semester, a.departmentId)}
                              >
                                <ArrowLeftIcon className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />Remove
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                      <Pagination
                        page={assignPage}
                        pageSize={assignPageSize}
                        total={semesterAssignments.length}
                        onPageChange={setAssignPage}
                        onPageSizeChange={() => {}}
                        disabled={false}
                      />
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
