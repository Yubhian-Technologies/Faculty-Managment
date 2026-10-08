"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { BookOpen, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import type { Course, CourseCatalogItem, CourseYearTiming, Department, Subject, SubjectSemesterAssignment } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";
import { fedYears, regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";
import { deriveHodScope, managerEffectiveYears } from "@/lib/departments/hodScope";
import { parseAcademicYearStart } from "@/lib/college/academicSession";
import { resolveCurrentSemester } from "@/lib/college/semester";
import { yearSemesterLabelIn, semesterInYearLabel } from "@/lib/academic/format";

const ALL_REGULATIONS = "__all__"; // sentinel: Radix Select items can't use an empty string value

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// This page used to read/write master Subject docs directly, filtered by a
// `year` param /api/college/subjects has never actually read (silently a
// no-op) and gated Edit/Delete on a `department` field new master subjects
// (courseId+regulation scoped, department-independent - see that route's
// own GET doc-comment) never populate - both client- and server-side
// (subjects/[id]/route.ts's own HOD check), so those buttons were dead for
// every subject created after the master-subject restructuring, and Delete,
// had it ever fired, would have hard-deleted the shared master subject for
// every OTHER department teaching this course too.
//
// Rebuilt on the actual current model: what's "offered" to an HOD's
// department is a SubjectSemesterAssignment (Assign to Semester's own
// output) - department+semester scoped, not a raw master-subject list. This
// page is read-only for an HOD: subjects (and what's assigned to each
// semester) are managed by Academics.
export default function HODSubjectsPage() {
  const myDepartments = useMyDepartments();
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignments, setAssignments] = useState<SubjectSemesterAssignment[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  // Course Catalog entries (regulations/regulationBatches per course) - the
  // Regulation picker below is sourced from here, same as HOD Sections' own
  // regulation picker (hod/sections/new/page.tsx), rather than only from
  // whatever's already assigned for this course/year/semester.
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  // The college's own configured current session, when a Principal has set
  // one (Settings > Academic Year) - used only to resolve which regulation
  // batch currently occupies the selected year (same pattern as HOD
  // Sections' currentSessionStart). Falls back to the plain date-based
  // session when nothing's configured yet.
  const [currentSessionStart, setCurrentSessionStart] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

  // Explicit picks only - "" means "no override yet, use the default below".
  // Keeping these separate from the effective values actually shown avoids
  // needing an effect to sync state just to pick a default.
  const [pickedCourseKey, setPickedCourseKey] = useState("");
  const [pickedDeptId, setPickedDeptId] = useState("");
  const [pickedYear, setPickedYear] = useState("");
  const [pickedSemester, setPickedSemester] = useState<number | null>(null);
  // "" means "All regulations" - lets an HOD tell apart subjects filed under
  // different curriculum regulations when a year has more than one active
  // (e.g. a transition batch).
  const [pickedRegulation, setPickedRegulation] = useState("");

  // What the Load button last asked for. Course/Year only choose WHAT to load;
  // Semester and Regulation are filters over the loaded course-year (their
  // options come from the timings/assignments it returns), so they only
  // appear once something is loaded and never trigger a fetch themselves.
  const [applied, setApplied] = useState<{ courseId: string; year: string; deptId: string } | null>(null);
  // Which course-year the loaded `timings` belong to - so "no semesters
  // configured" is only claimed once that lookup has actually finished.
  const [timingsFor, setTimingsFor] = useState("");
  // Semester and Regulation are real filters chosen BEFORE Load - their options
  // come from a light lookup (the course-year's timings + the catalog) that
  // runs when Course and Year are picked, not from the loaded subject list.

  const loadCourses = useCallback(async () => {
    setIsLoading(true);
    try {
      const [coursesRes, deptsRes] = await Promise.all([
        fetch("/api/college/courses"),
        fetch("/api/college/departments"),
      ]);
      const coursesData = await coursesRes.json() as { courses: Course[] };
      const deptsData = await deptsRes.json() as { departments: Department[] };
      setCourses((coursesData.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      setDepartments(deptsData.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await loadCourses(); })();
  }, [loadCourses]);

  useEffect(() => {
    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => {});

    fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions?: { label: string; isCurrent: boolean }[] }>)
      .then((d) => {
        const current = (d.academicSessions ?? []).find((s) => s.isCurrent);
        setCurrentSessionStart(current ? parseAcademicYearStart(current.label) ?? null : null);
      })
      .catch(() => { /* non-critical - falls back to the date-based session */ });
  }, []);

  // Each department owns its own course row for the same catalog programme,
  // but the Course picker lists each programme once; which department's
  // subjects are shown is chosen separately in the Department picker (what is
  // assigned to a semester is stored against the department it was imported
  // to, not against whichever department owns the course row being browsed).
  const courseKey = (c: Course) => c.catalogId ?? `name:${c.name}`;
  const courseGroups = useMemo(() => {
    const groups = new Map<string, Course[]>();
    for (const c of courses) {
      const k = courseKey(c);
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    return Array.from(groups.entries()).map(([key, rows]) => ({ key, name: rows[0].name, rows }));
  }, [courses]);

  // Default straight to the first course/year - Course/Year stay switchable
  // via the pickers below for departments with more than one, but the HOD
  // shouldn't have to click through both just to see subjects that are
  // almost always already there.
  const selectedGroup = courseGroups.find((g) => g.key === pickedCourseKey) ?? courseGroups[0] ?? null;
  // The course dropdown includes courses from OTHER departments this HOD only
  // reaches by managing their shared first year (e.g. Basic Science browsing
  // IT's own "Bachelor of Technology" doc - see api/college/courses' HOD
  // scope union). So the years to offer can't come from that course's own
  // owning department (IT's own assignedYears is [2,3,4] - IT's own HOD's
  // years, not what Basic Science was assigned) - they must come from THIS
  // HOD's own department(s), the same way Teaching Assignments/Sections
  // resolve it (deriveHodScope + managerEffectiveYears): own department plus
  // its real sub-departments (never a managed branch's own later years).
  const ownScopeDepartments = useMemo(() => {
    const seen = new Map<string, Department>();
    for (const name of myDepartments) {
      const scope = deriveHodScope(departments, name);
      if (scope.ownDept) seen.set(scope.ownDept.id, scope.ownDept);
      for (const d of [...scope.groupingChildren, ...scope.plainChildren]) seen.set(d.id, d);
    }
    return Array.from(seen.values());
  }, [departments, myDepartments]);
  // Departments whose subjects this HOD may view: own department plus its
  // sub-departments; falls back to the owners of the listed courses.
  const deptOptions = useMemo(() => {
    if (ownScopeDepartments.length > 0) return ownScopeDepartments;
    const seen = new Map<string, Department>();
    for (const c of courses) {
      const d = departments.find((x) => x.id === c.departmentId);
      if (d) seen.set(d.id, d);
    }
    return Array.from(seen.values());
  }, [ownScopeDepartments, courses, departments]);
  const selectedDeptId = deptOptions.some((d) => d.id === pickedDeptId) ? pickedDeptId : (deptOptions[0]?.id ?? "");
  // The course row used for timings/years: the selected department's own row
  // when it has one, otherwise the programme's first row.
  const selectedCourse = useMemo(
    () => selectedGroup ? (selectedGroup.rows.find((c) => c.departmentId === selectedDeptId) ?? selectedGroup.rows[0]) : null,
    [selectedGroup, selectedDeptId]
  );
  const selectedCourseId = selectedCourse?.id ?? "";
  const selectedDeptName = deptOptions.find((d) => d.id === selectedDeptId)?.name ?? "";
  // Never the raw 1..durationYears span - only the years the Principal
  // actually assigned this HOD's own scope for this course (per-course
  // override included, via managerEffectiveYears). Nothing assigned means no
  // years - never "every year of the course" (lib/college/taughtYears.ts). A
  // year some OTHER department already claims as a feeder for this scope
  // (fedYears) is excluded.
  const yearOptions = useMemo(() => {
    if (!selectedCourse) return [];
    const courseYears = Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1);
    const assigned = new Set<number>();
    const excluded = new Set<number>();
    for (const d of ownScopeDepartments) {
      for (const y of managerEffectiveYears(d, departments, selectedCourse.catalogId)) assigned.add(y);
      for (const y of fedYears(d, departments, selectedCourse.catalogId)) excluded.add(y);
    }
    return courseYears.filter((y) => assigned.has(y) && !excluded.has(y));
  }, [selectedCourse, ownScopeDepartments, departments]);
  const selectedYear = pickedYear || (yearOptions.length > 0 ? String(yearOptions[0]) : "");

  const selectedCatalogItem = useMemo(
    () => catalogItems.find((c) => c.id === selectedCourse?.catalogId) ?? null,
    [catalogItems, selectedCourse]
  );

  const timingsReady = timingsFor === `${selectedCourseId}|${selectedYear}`;
  const semesterOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const t of timings) for (const s of t.semesters ?? []) nums.add(s.semester);
    return Array.from(nums).sort((a, b) => a - b);
  }, [timings]);
  // Defaults to whichever semester's own date range covers today, when the
  // HOD hasn't picked one explicitly - falls back to the first configured
  // semester when no semester's dates cover today (or none are dated yet).
  const currentTiming = useMemo(() => timings.find((t) => t.year === Number(selectedYear)) ?? null, [timings, selectedYear]);
  const resolvedCurrentSemester = useMemo(() => resolveCurrentSemester(currentTiming), [currentTiming]);
  const effectiveSemester = semesterOptions.length === 0
    ? null
    : pickedSemester != null && semesterOptions.includes(pickedSemester)
      ? pickedSemester
      : resolvedCurrentSemester != null && semesterOptions.includes(resolvedCurrentSemester)
        ? resolvedCurrentSemester
        : semesterOptions[0];

  // Sourced from the Course Catalog (same resolution HOD Sections' and Academics
  // Subjects' own regulation pickers use), unioned with whatever's already
  // assigned for this course/year/semester - so a regulation the Academics just
  // configured shows up even before anything uses it (this control used
  // to be a post-hoc filter over already-loaded rows, which meant an
  // empty list always meant an empty, disabled dropdown with no
  // explanation why), while a legacy/edge-case assignment the catalog can no
  // longer resolve stays filterable too.
  const catalogRegulations = useMemo(
    () => (selectedCourse?.catalogId && selectedYear
      ? regulationsForCourseYearByBatch(
          selectedCatalogItem?.regulationBatches ?? {},
          Number(selectedYear),
          currentSessionStart ?? undefined,
          selectedCatalogItem?.regulations,
        )
      : []),
    [selectedCourse, selectedCatalogItem, selectedYear, currentSessionStart]
  );
  const assignmentsForSemester = useMemo(
    () => assignments.filter((a) => a.semester === effectiveSemester),
    [assignments, effectiveSemester]
  );
  const regulationOptions = useMemo(
    () => Array.from(new Set([
      ...catalogRegulations,
      ...assignmentsForSemester.map((a) => a.regulation).filter((r): r is string => !!r),
    ])).sort(),
    [catalogRegulations, assignmentsForSemester]
  );
  const regulationEmptyReason = useMemo(() => {
    if (regulationOptions.length > 0) return null;
    if (!selectedCourse?.catalogId) return "This course isn't linked to a Course Catalog entry.";
    return "No regulation is configured for this year yet — set one in Course Catalog (Academics).";
  }, [regulationOptions, selectedCourse]);

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const visibleAssignments = useMemo(() => {
    const filtered = pickedRegulation
      ? assignmentsForSemester.filter((a) => !a.regulation || a.regulation === pickedRegulation)
      : assignmentsForSemester;
    // Curriculum-table order: by the master subject's own S.No. when set
    // (SubjectSemesterAssignment doesn't carry its own), falling back to name.
    return [...filtered].sort((a, b) => {
      const sa = subjectById.get(a.subjectId)?.serialNumber;
      const sb = subjectById.get(b.subjectId)?.serialNumber;
      if (sa != null && sb != null) return sa - sb;
      if (sa != null) return -1;
      if (sb != null) return 1;
      return a.subjectName.localeCompare(b.subjectName);
    });
  }, [assignmentsForSemester, pickedRegulation, subjectById]);

  // Subjects (catalogId-scoped, department-independent) alongside Course-Year
  // Timings and this department's own semester assignments - same three-way
  // load Assign to Semester itself does, so S.No./category/etc join
  // correctly and Semester options resolve from real timing data instead of
  // a param the API silently ignored (the bug this page used to have).
  const loadAssignments = useCallback(async (course: Course, siblings: Course[], year: string, deptId: string) => {
    setIsLoadingAssignments(true);
    try {
      const catalogId = course.catalogId ?? "";
      const [subjectsRes, ...assignmentsResList] = await Promise.all([
        fetch(catalogId
          ? `/api/college/subjects?catalogId=${encodeURIComponent(catalogId)}`
          : `/api/college/subjects?courseId=${encodeURIComponent(course.id)}`),
        ...siblings.map((c) => fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(c.id)}&departmentId=${encodeURIComponent(deptId)}&year=${encodeURIComponent(year)}`)),
      ]);
      const subjectsData = await subjectsRes.json() as { subjects?: Subject[] };
      const merged = new Map<string, SubjectSemesterAssignment>();
      for (const r of assignmentsResList) {
        const data = await r.json() as { assignments?: SubjectSemesterAssignment[] };
        for (const a of data.assignments ?? []) merged.set(a.id, a);
      }
      setSubjects(subjectsData.subjects ?? []);
      setAssignments(Array.from(merged.values()));
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingAssignments(false);
    }
  }, []);

  // Option lookup for the Semester filter: the picked course-year's timings.
  // Runs on selection (it only fills a dropdown); the subject list itself waits
  // for Load.
  useEffect(() => {
    if (!selectedCourseId || !selectedYear) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(selectedCourseId)}`);
        const json = (await res.json()) as { timings?: CourseYearTiming[] };
        if (!cancelled) {
          setTimings((json.timings ?? []).filter((t) => t.year === Number(selectedYear)));
          setTimingsFor(`${selectedCourseId}|${selectedYear}`);
        }
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load semesters" });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCourseId, selectedYear]);

  useEffect(() => {
    if (!applied) return;
    const course = courses.find((c) => c.id === applied.courseId);
    if (course) void loadAssignments(course, courses.filter((c) => courseKey(c) === courseKey(course)), applied.year, applied.deptId);
  }, [applied, courses, loadAssignments]);

  // A changed Course/Year invalidates what's on screen - cleared here, in the
  // handlers, not in an effect.
  function clearLoaded() {
    setApplied(null);
    setSubjects([]);
    setTimings([]);
    setAssignments([]);
  }
  // Changing Semester or Regulation also invalidates the loaded view.

  function selectDept(deptId: string) {
    clearLoaded();
    setPickedDeptId(deptId);
    setPickedYear("");
    setPickedSemester(null);
    setPickedRegulation("");
  }

  function selectCourse(key: string) {
    clearLoaded();
    setPickedCourseKey(key);
    setPickedYear(""); // fall back to the new course's own first year
    setPickedSemester(null);
    setPickedRegulation("");
  }

  function selectYear(year: string) {
    clearLoaded();
    setPickedYear(year);
    setPickedSemester(null);
    setPickedRegulation("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Subjects assigned to your department for a semester, and their hours/credits"
      />

      {isLoading ? (
        <div className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
      ) : courses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for your department yet. Ask the Principal to add courses under Departments first.
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={selectedGroup?.key ?? ""} onValueChange={selectCourse}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    {courseGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={selectedDeptId} onValueChange={selectDept} disabled={deptOptions.length === 0}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {deptOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
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
                <Label>Semester</Label>
                {timingsReady && semesterOptions.length === 0 ? (
                  <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3">
                    <span className="text-xs text-muted-foreground">Not configured for this year</span>
                  </div>
                ) : (
                  <Select
                    value={effectiveSemester != null ? String(effectiveSemester) : ""}
                    onValueChange={(v) => { setApplied(null); setPickedSemester(Number(v)); }}
                    disabled={!selectedYear || semesterOptions.length === 0}
                  >
                    <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                    <SelectContent>
                      {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>{semesterInYearLabel(semesterOptions, s, { format: "short" })}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Regulation</Label>
                <Select
                  value={pickedRegulation || ALL_REGULATIONS}
                  onValueChange={(v) => { setApplied(null); setPickedRegulation(v === ALL_REGULATIONS ? "" : v); }}
                  disabled={!selectedYear || regulationOptions.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder="All regulations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_REGULATIONS}>All regulations</SelectItem>
                    {regulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selectedYear && regulationEmptyReason && (
                  <p className="text-xs text-muted-foreground">{regulationEmptyReason}</p>
                )}
              </div>
              <div className="space-y-1.5 flex flex-col justify-end sm:col-span-2 lg:col-span-4">
                <div>
                  <Button
                    onClick={() => selectedCourseId && selectedYear && effectiveSemester != null && setApplied({ courseId: selectedCourseId, year: selectedYear, deptId: selectedDeptId })}
                    disabled={!selectedCourseId || !selectedDeptId || !selectedYear || effectiveSemester == null || isLoadingAssignments}
                  >
                    <Search className="h-4 w-4 mr-2" />{applied ? "Reload Subjects" : "Load Subjects"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {!applied && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Select the course, year, semester and regulation, then press Load Subjects.
            </div>
          )}

          {timingsReady && semesterOptions.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              This course-year has no semesters configured yet. Set them up in Course-Year Timings first.
            </div>
          )}

          {applied && effectiveSemester != null && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  {selectedCourse?.name ?? ""} · {selectedDeptName} · {ordinalYear(Number(selectedYear))} · Sem {yearSemesterLabelIn(Number(selectedYear), semesterOptions, Number(effectiveSemester))}
                </h2>

                {isLoadingAssignments ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
                  </div>
                ) : assignmentsForSemester.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No subjects assigned to this department for this semester yet.
                  </p>
                ) : visibleAssignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No subjects for this semester under regulation {pickedRegulation}.
                  </p>
                ) : (
                  <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-4 py-3">S.No.</th>
                            <th className="px-4 py-3">Category</th>
                            <th className="px-4 py-3">Name of the Subject</th>
                            <th className="px-4 py-3 text-center">L</th>
                            <th className="px-4 py-3 text-center">T</th>
                            <th className="px-4 py-3 text-center">P</th>
                            <th className="px-4 py-3 text-center">Credits</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {visibleAssignments.map((a) => {
                            const subject = subjectById.get(a.subjectId);
                            return (
                              <tr key={a.id}>
                                <td className="px-4 py-2.5">{subject?.serialNumber ?? "—"}</td>
                                <td className="px-4 py-2.5">
                                  {(a.category ?? subject?.category) ? (
                                    <Badge variant="outline" className="text-xs">
                                      {(a.category ?? subject?.category) === "OTHER" ? (a.customCategory || subject?.customCategory || "Other") : (a.category ?? subject?.category)}
                                    </Badge>
                                  ) : "—"}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="font-medium text-foreground">{a.subjectName}</div>
                                  <div className="flex flex-wrap items-center gap-2 mt-1">
                                    <Badge variant="secondary" className="text-xs font-mono">{a.subjectCode}</Badge>
                                    <Badge variant="outline" className="text-xs">{SUBJECT_TYPE_LABELS[a.type ?? subject?.type ?? "THEORY"]}</Badge>
                                    {a.regulation && <Badge variant="secondary" className="text-xs">{a.regulation}</Badge>}
                                    <span className="text-xs text-muted-foreground">{a.hoursPerWeek ?? subject?.hoursPerWeek ?? 0} hrs/week</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-center">{a.lectureHours ?? subject?.lectureHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{a.tutorialHours ?? subject?.tutorialHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{a.practicalHours ?? subject?.practicalHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{a.credits ?? subject?.credits ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
