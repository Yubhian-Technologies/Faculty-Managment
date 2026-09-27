"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowLeft as ArrowLeftIcon, Search, Layers, CheckSquare } from "lucide-react";
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

// A master subject (Subject.catalogId + year, department-independent - see
// its own doc-comment in types/teaching.ts) can be mapped into a DIFFERENT
// semester by different departments - Physics might be Semester 1 for CSE
// and Semester 2 for ECE. That's a real many-to-many relationship, so it's
// its own collection (SubjectSemesterAssignment, doc id
// `${subjectId}_${departmentId}`) rather than a single field on Subject.
//
// Picker order: Department -> Course -> Year -> Regulation -> Semester. This
// is an ordinary department-scoped picker (Department's own courses only) -
// unlike Master Subjects' own Regulation-first picker, there's no need to
// resolve "which department's course doc" here, because the mapping this
// page creates is keyed by departmentId directly.
//
// Sub-department support: when a top-level department has children
// (e.g. Basic Science → BS-Chemistry, BS-Mathematics), the picker
// shows those children under the parent so subjects can be assigned
// to the specific sub-department, not just the parent.
export default function AssignToSemesterPage() {
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

  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedRegulation, setSelectedRegulation] = useState("");
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

  const catalogById = useMemo(() => new Map(catalogItems.map((c) => [c.id, c])), [catalogItems]);
  const selectedDepartment = useMemo(
    () => allDepartments.find((d) => d.id === selectedDepartmentId) ?? null,
    [allDepartments, selectedDepartmentId]
  );
  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) ?? null, [courses, selectedCourseId]);

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
  const yearOptions = useMemo(() => {
    if (!selectedCourse || !selectedDepartment) return [];
    const courseYears = Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1);
    const catalogId = selectedCourse.catalogId;
    const assigned = managerTeachingYears(allDepartments, selectedDepartment, catalogId);
    if (assigned.length > 0) {
      return courseYears.filter((y) => assigned.includes(y));
    }
    const excluded = new Set(fedYears(selectedDepartment, allDepartments, catalogId));
    return courseYears.filter((y) => !excluded.has(y));
  }, [selectedCourse, selectedDepartment, allDepartments]);

  const catalogItemForCourse = useMemo(
    () => catalogById.get(selectedCourse?.catalogId ?? "") ?? null,
    [selectedCourse, catalogById]
  );

  const regulationOptions = useMemo(() => {
    if (!selectedCourse) return [];
    return catalogItemForCourse?.regulations ?? [];
  }, [selectedCourse, catalogItemForCourse]);

  // Which regulation(s) this course's own Course Catalog batch coverage says
  // actually governs the selected Year, as of the current academic session -
  // the same batch-aware resolution Section creation already enforces
  // server-side (sections/route.ts POST) and the Subjects picker offers
  // (academics/subjects/new/page.tsx). Normally resolves to exactly one;
  // empty when nothing does (no regulationBatches configured for this
  // course, or a Year no configured batch currently covers) -
  // regulationsForCourseYearByBatch's own backward-compatibility fallback
  // applies here too: an unconfigured course (regulationBatches absent)
  // makes this resolve to every one of the
  // course's regulations, not none, so a college that hasn't set batches up
  // yet keeps its previous "pick manually" behavior rather than being told
  // "no regulation assigned" for every year.
  const yearRegulationMatches = useMemo(() => {
    if (!selectedCourse || !selectedYear || !catalogItemForCourse) return [];
    return regulationsForCourseYearByBatch(
      catalogItemForCourse.regulationBatches ?? {},
      Number(selectedYear),
      currentAcademicStartYear(),
      catalogItemForCourse.regulations,
    );
  }, [selectedCourse, selectedYear, catalogItemForCourse]);

  // Auto-fill the Regulation field the moment exactly one regulation
  // resolves for the selected Year - mirrors the accurate, batch-aware
  // check Sections already enforce, so this page's default stops depending
  // on whoever's filling the form remembering which regulation each batch
  // maps to. Left blank (not force-picked) when zero or more than one
  // regulation resolves - see the Regulation field's own "no regulation
  // assigned for this year" fallback below for the zero case, and the plain
  // Select for the ambiguous (>1, misconfigured Course Catalog) case, so a
  // person can still resolve either manually rather than being blocked.
  useEffect(() => {
    if (yearRegulationMatches.length === 1) {
      setSelectedRegulation(yearRegulationMatches[0]);
    }
  }, [yearRegulationMatches]);

  // True only when this course DOES have regulations configured at all
  // (regulationOptions non-empty - the pre-existing "None assigned" message
  // below already covers the other case) but none of them actually cover
  // the selected Year for the current session - the specific, accurate
  // "batch gap" the calculation above exists to catch.
  const noRegulationForYear = Boolean(selectedYear) && regulationOptions.length > 0 && yearRegulationMatches.length === 0;

  const semesterOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const t of timings) for (const s of t.semesters ?? []) nums.add(s.semester);
    return Array.from(nums).sort((a, b) => a - b);
  }, [timings]);
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
  const loadCourses = useCallback(async (departmentId: string) => {
    setIsLoadingCourses(true);
    try {
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
      const data = await res.json() as { courses?: Course[] };
      setCourses((data.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
    } finally {
      setIsLoadingCourses(false);
    }
  }, []);

  // Master Collection = every subject for this catalog course+year
  // (department-independent). Semester panel = this DEPARTMENT's own
  // mappings for that catalog+year, from the junction collection.
  const loadSubjectsAndTimings = useCallback(async (course: Course, departmentId: string, year: string) => {
    setIsLoadingSubjects(true);
    try {
      const catalogId = course.catalogId ?? "";
      // Master subjects are course+regulation scoped only (no ordinal `year`
      // field - see types/teaching.ts's own Subject.year comment), so the
      // GET route never reads a `year` param; `year` is still this
      // function's own param (used below for the assignment/instance calls
      // that DO need it - Year is what a department's mapping is keyed by).
       const [subjectsRes, timingsRes, assignmentsRes] = await Promise.all([
        fetch(`/api/college/subjects?courseId=${encodeURIComponent(course.id)}`),
        fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(course.id)}`),
        fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(course.id)}&departmentId=${encodeURIComponent(departmentId)}`),
      ]);
      const subjectsData = await subjectsRes.json() as { subjects?: Subject[] };
      const timingsData = await timingsRes.json() as { timings?: CourseYearTiming[] };
      const assignmentsData = assignmentsRes ? await assignmentsRes.json() as { assignments?: SubjectSemesterAssignment[] } : { assignments: [] };
      setSubjects(subjectsData.subjects ?? []);
      setTimings((timingsData.timings ?? []).filter((t) => t.year === Number(year)));
      setAssignments(assignmentsData.assignments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingSubjects(false);
    }
  }, []);

  function selectDepartment(departmentId: string) {
    setSelectedDepartmentId(departmentId);
    setSelectedCourseId("");
    setSelectedYear("");
    setSelectedRegulation("");
    setSelectedSemester(null);
    setCourses([]);
    setSubjects([]);
    setAssignments([]);
    setTimings([]);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
    void loadCourses(departmentId);
  }

  function selectCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setSelectedYear("");
    setSelectedRegulation("");
    setSelectedSemester(null);
    setSubjects([]);
    setAssignments([]);
    setTimings([]);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
  }

  function selectYear(year: string) {
    setSelectedYear(year);
    setSelectedSemester(null);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
    if (selectedCourse) void loadSubjectsAndTimings(selectedCourse, selectedDepartmentId, year);
  }

  async function setSubjectSemester(subject: Subject, semester: number | null) {
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
        const res = await fetch(
          `/api/college/subject-semester-assignments?subjectId=${encodeURIComponent(subject.id)}&departmentId=${encodeURIComponent(selectedDepartment.id)}`,
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

  const assignedSubjectIds = useMemo(() => new Set(assignments.map((a) => a.subjectId)), [assignments]);
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
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={selectedDepartmentId} onValueChange={selectDepartment}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
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
              </div>
              <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={selectedCourseId} onValueChange={selectCourse} disabled={!selectedDepartment || isLoadingCourses}>
                  <SelectTrigger><SelectValue placeholder={isLoadingCourses ? "Loading…" : "Select course"} /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={selectedYear} onValueChange={selectYear} disabled={!selectedCourse}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Regulation</Label>
                {noRegulationForYear ? (
                  <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3">
                    <span className="text-xs text-muted-foreground">No regulation assigned for this year</span>
                  </div>
                ) : (
                  <Select value={selectedRegulation} onValueChange={setSelectedRegulation} disabled={!selectedYear || regulationOptions.length === 0}>
                    <SelectTrigger><SelectValue placeholder={regulationOptions.length ? "Select regulation" : "None assigned"} /></SelectTrigger>
                    <SelectContent>
                      {regulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Semester</Label>
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
                    <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                    <SelectContent>
                      {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedDepartment && !isLoadingCourses && courses.length === 0 && (
            <p className="text-sm text-muted-foreground px-1">
              No courses have been set up for {selectedDepartment.name} yet.
            </p>
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
                        <Layers className="h-4 w-4" />
                        Master Collection
                      </CardTitle>
                      {selectedSubjectIds.length > 0 && (
                        <Button
                          size="sm"
                          variant="default"
                          loading={isBulkAssigning}
                          onClick={() => void handleBulkAssign()}
                        >
                          <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                          Assign {selectedSubjectIds.length} to Sem {effectiveSemester}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
                        Nothing left to add - every master subject already has a semester for {selectedDepartment?.name ?? ""}.
                      </p>
                     ) : paginatedMasterPool.length === 0 ? (
                       <p className="text-sm text-muted-foreground text-center py-6">
                         No subjects match &quot;{searchText}&quot;.
                       </p>
                     ) : (
                       <>
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
                                   Add<ArrowRight className="h-3.5 w-3.5 ml-1.5" />
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
                         ? `Semester ${effectiveSemester} Instances - ${selectedDepartment?.name} (sub-department)`
                         : `Semester ${effectiveSemester} Instances - ${selectedDepartment?.name ?? ""}`}
                     </CardTitle>
                   </CardHeader>
                   <CardContent>
                     {paginatedAssignments.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No subjects assigned to this semester yet. Select from Master Collection and click Add or Bulk Assign.
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
                                onClick={() => void setSubjectSemester(subject ?? { id: a.subjectId } as Subject, null)}
                              >
                                <ArrowLeftIcon className="h-3.5 w-3.5 mr-1.5" />Remove
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
