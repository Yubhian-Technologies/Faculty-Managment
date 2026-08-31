"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Plus, Pencil, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, Department, Subject } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";
import { academicSessionLabel, currentAcademicStartYear, recentAcademicSessions, parseAcademicYearStart } from "@/lib/college/academicSession";
import { resolveDepartmentCourseScope, regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Dean's version of the HOD Subjects page - same subject list/add/edit/delete,
// but drilled down Department -> Course -> Year instead of just Course -> Year,
// since a Dean isn't scoped to one department the way an HOD is.
export default function DeanSubjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  // Course Catalog entries (regulations/regulationBatches per course) - used
  // to resolve which regulation(s) govern the selected course's selected
  // year, same source hod/sections/new/page.tsx's own regulation picker reads.
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  // Calendar academic session (e.g. "2026-27") a subject is tagged with when
  // the Dean adds it, AND what "now" means for resolving which regulation
  // covers a year below (regulationsForCourseYearByBatch) - defaults to the
  // real current session, but picking a different one here lets the Dean
  // browse which regulation covered a year in a past/future session too.
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicSessionLabel(currentAcademicStartYear()));
  // The college's own configured current session (Settings > Academic Year),
  // when a Principal has set one - applied over the plain clock-based default
  // above once loaded (see the effect below), so this page's notion of "now"
  // agrees with HOD Sections' (hod/sections/new/page.tsx) and the server's
  // (sections/route.ts) rather than drifting from it.
  const [currentSessionLabel, setCurrentSessionLabel] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => {
        // Top-level departments only - sub-departments (parentDepartmentId
        // set, e.g. BS-CHEMISTRY/BS-Mathematics under Basic Science) share
        // their parent's courses rather than owning any of their own (see
        // getHodDepartmentScope), so they'd never resolve to a real course
        // here anyway - hide them from the picker instead of listing a
        // dead end.
        const topLevel = (d.departments ?? []).filter((dept) => !dept.parentDepartmentId);
        setDepartments(topLevel.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));

    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => {});

    fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions?: { label: string; isCurrent: boolean }[] }>)
      .then((d) => {
        const current = (d.academicSessions ?? []).find((s) => s.isCurrent);
        if (current?.label) setCurrentSessionLabel(current.label);
      })
      .catch(() => { /* non-critical - falls back to the date-based session */ });
  }, []);

  // Apply the college's configured current session over the clock-only
  // default, once it loads - but never fight a URL-restored session (see
  // hasRestoredRef below), and never override a session the Dean has since
  // picked by hand.
  const hasAppliedSessionRef = useRef(false);
  useEffect(() => {
    if (hasAppliedSessionRef.current || !currentSessionLabel || searchParams.get("academicYear")) return;
    hasAppliedSessionRef.current = true;
    setSelectedAcademicYear(currentSessionLabel);
  }, [currentSessionLabel, searchParams]);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === selectedDepartmentId) ?? null,
    [departments, selectedDepartmentId]
  );
  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) ?? null, [courses, selectedCourseId]);
  // Scoped to the course's own ACTUAL owning department's "Years Taught"
  // (resolveDepartmentCourseScope), not the raw 1..durationYears span, and
  // deliberately not the top-level Department picker either - loadCourses
  // above can surface a feeder's own course row under a fed department that
  // owns none of its own (e.g. Basic Science's course shown while "CSE" is
  // picked above), and that course's real scope lives on Basic Science, not
  // CSE. Matching the fed department's own (wrong) years here is exactly
  // what used to make the feeder's reserved year unreachable - see
  // hod/subjects/page.tsx's courseLabel/yearOptions for the same fix already
  // applied there.
  const courseOwningDepartment = useMemo(
    () => (selectedCourse ? departments.find((d) => d.id === selectedCourse.departmentId) ?? null : null),
    [selectedCourse, departments]
  );
  const yearOptions = useMemo(() => {
    if (!selectedCourse || !courseOwningDepartment) return [];
    const courseYears = Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1);
    const assigned = resolveDepartmentCourseScope(courseOwningDepartment, selectedCourse.catalogId).assignedYears;
    return assigned.length > 0 ? courseYears.filter((y) => assigned.includes(y)) : courseYears;
  }, [selectedCourse, courseOwningDepartment]);
  const selectedCatalogItem = useMemo(
    () => catalogItems.find((c) => c.id === selectedCourse?.catalogId) ?? null,
    [catalogItems, selectedCourse]
  );
  // Whichever regulation(s) govern the selected year AS OF the selected
  // Academic Year session above, resolved from this course's own Course
  // Catalog entry's regulationBatches - purely informational (shown as a
  // badge, tagged onto a new subject when unambiguous), never a gate on
  // adding subjects, which are scoped by Academic Year session instead
  // (see loadSubjects).
  const allowedRegulations = useMemo(
    () => (selectedYear
      ? regulationsForCourseYearByBatch(
          selectedCatalogItem?.regulationBatches ?? {},
          Number(selectedYear),
          parseAcademicYearStart(selectedAcademicYear) ?? currentAcademicStartYear(),
          selectedCatalogItem?.regulations,
        )
      : []),
    [selectedCatalogItem, selectedYear, selectedAcademicYear]
  );
  // The single regulation to tag a new subject with - only when unambiguous.
  const singleRegulation = allowedRegulations.length === 1 ? allowedRegulations[0] : "";

  // recentAcademicSessions() is clock-anchored only, so a college whose
  // configured current session (currentSessionLabel, applied above) has
  // drifted from the plain calendar date would otherwise select a value
  // missing from the dropdown's own option list. Same self-healing pattern as
  // hod/sections' batchOptions: keep the actually-selected session in the
  // list even when the clock-derived window doesn't cover it.
  const academicYearOptions = useMemo(() => {
    const base = recentAcademicSessions();
    return base.includes(selectedAcademicYear) ? base : [selectedAcademicYear, ...base];
  }, [selectedAcademicYear]);

  // Curriculum-table order: by S.No. when set (matches a printed curriculum
  // sheet), falling back to name for legacy subjects that predate the field.
  const sortedSubjects = useMemo(
    () => [...subjects].sort((a, b) => {
      if (a.serialNumber != null && b.serialNumber != null) return a.serialNumber - b.serialNumber;
      if (a.serialNumber != null) return -1;
      if (b.serialNumber != null) return 1;
      return a.name.localeCompare(b.name);
    }),
    [subjects]
  );
  const nextSerialNumber = useMemo(
    () => Math.max(0, ...subjects.map((s) => s.serialNumber ?? 0)) + 1,
    [subjects]
  );

  const loadCourses = useCallback(async (departmentId: string) => {
    setIsLoadingCourses(true);
    try {
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
      const data = await res.json() as { courses: Course[] };
      // The courses API also merges in a feeder's courses - a department that
      // cross-lists this one via secondaryDepartments (e.g. Basic Science
      // feeding CSE for the shared first year) - so a single catalog course the
      // Principal added once came back twice, once per owning department, and
      // rendered as two identical "Bachelor of Technology" options here.
      //
      // Collapsed to one entry per catalog course (falling back to the
      // normalized name for legacy courses created before the catalog), keeping
      // THIS department's own doc when both exist so subjects file against the
      // department the Dean actually picked. A feeder's copy is still kept when
      // the department owns none, which is the case that merge exists for - see
      // yearOptions below, which resolves scope against the SURVIVING course's
      // own owning department (not necessarily the one picked above) so the
      // feeder's reserved year is still reachable through it rather than stuck
      // showing the fed department's own (wrong) years.
      const active = (data.courses ?? []).filter((c) => c.isActive);
      const byCatalogCourse = new Map<string, Course>();
      for (const c of active) {
        const key = c.catalogId ?? `name:${c.name.trim().toLowerCase()}`;
        const kept = byCatalogCourse.get(key);
        if (!kept || (c.departmentId === departmentId && kept.departmentId !== departmentId)) {
          byCatalogCourse.set(key, c);
        }
      }
      const list = Array.from(byCatalogCourse.values()).sort((a, b) => a.name.localeCompare(b.name));
      setCourses(list);
      return list;
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
      return [];
    } finally {
      setIsLoadingCourses(false);
    }
  }, []);

  // Scoped by Academic Year session, not regulation - each session (e.g.
  // "2026-27") gets its own independent, persisted subject list per
  // course-year, filled in fresh by the Dean every year rather than carried
  // over or auto-reset when a different regulation happens to resolve.
  const loadSubjects = useCallback(async (departmentName: string, courseId: string, year: string, academicYear: string) => {
    if (!departmentName || !courseId || !year) { setSubjects([]); return; }
    setIsLoadingSubjects(true);
    try {
      const res = await fetch(
        `/api/college/subjects?department=${encodeURIComponent(departmentName)}&courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}${academicYear ? `&academicYear=${encodeURIComponent(academicYear)}` : ""}`
      );
      const data = await res.json() as { subjects: Subject[] };
      // The API also returns a feeder's shared subjects for a fed department
      // (e.g. Basic Science's 1st-year subjects under CSE/ECE/IT/CIVIL) so an
      // HOD can staff them - the Dean browses departments one at a time
      // instead, so a fed department's own page shows only its own subjects;
      // Basic Science's are seen by selecting Basic Science itself above.
      setSubjects((data.subjects ?? []).filter((s) => s.department === departmentName));
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingSubjects(false);
    }
  }, []);

  // Coming back from "Add Subject"/"Edit" (see their departmentId/courseId/
  // year/academicYear query params on success) should land right back on the
  // same department, course, year and session instead of the blank pickers -
  // restore that selection once, as soon as the department list is in so
  // selectedDepartment can resolve. Runs at most once (hasRestoredRef) so it
  // doesn't fight the user's own subsequent picks.
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current || isLoading || departments.length === 0) return;
    hasRestoredRef.current = true;
    const departmentId = searchParams.get("departmentId");
    const courseId = searchParams.get("courseId");
    const year = searchParams.get("year");
    const academicYear = searchParams.get("academicYear") || selectedAcademicYear;
    if (!departmentId) return;
    const dept = departments.find((d) => d.id === departmentId);
    if (!dept) return;
    void (async () => {
      setSelectedDepartmentId(departmentId);
      setSelectedAcademicYear(academicYear);
      const list = await loadCourses(departmentId);
      if (courseId && list.some((c) => c.id === courseId)) {
        setSelectedCourseId(courseId);
        if (year) {
          setSelectedYear(year);
          await loadSubjects(dept.name, courseId, year, academicYear);
        }
      }
    })();
    // hasRestoredRef guards this to run at most once - selectedAcademicYear
    // in the deps just lets the effect see its latest default value the one
    // time it actually runs; it re-entering harmlessly no-ops afterwards.
  }, [isLoading, departments, searchParams, loadCourses, loadSubjects, selectedAcademicYear]);

  function selectDepartment(departmentId: string) {
    setSelectedDepartmentId(departmentId);
    setSelectedCourseId("");
    setSelectedYear("");
    setCourses([]);
    setSubjects([]);
    void loadCourses(departmentId);
  }

  function selectCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setSelectedYear("");
    setSubjects([]);
  }

  function selectAcademicYear(academicYear: string) {
    setSelectedAcademicYear(academicYear);
    // Switching session re-scopes the subject list (see loadSubjects) - each
    // session has its own independent list, so this reloads rather than
    // reusing whatever was showing for the previous session.
    if (selectedDepartment && selectedYear) void loadSubjects(selectedDepartment.name, selectedCourseId, selectedYear, academicYear);
  }

  function selectYear(year: string) {
    setSelectedYear(year);
    if (selectedDepartment) void loadSubjects(selectedDepartment.name, selectedCourseId, year, selectedAcademicYear);
  }

  async function handleDelete() {
    if (!deleteTarget || !selectedDepartment) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete subject");
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      await loadSubjects(selectedDepartment.name, selectedCourseId, selectedYear, selectedAcademicYear);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete subject" });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Manage subjects offered for each year of every department's courses"
        actions={
          <Button variant="outline" onClick={() => router.push("/dean/subjects/import")}>
            <Upload className="h-4 w-4 mr-2" />Import Subjects
          </Button>
        }
      />

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
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
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
                <Label>Academic Year</Label>
                {/* Scopes the subject list below (see loadSubjects) - each
                    session has its own independent list per course-year,
                    stamped onto subjects added under it. */}
                <Select value={selectedAcademicYear} onValueChange={selectAcademicYear}>
                  <SelectTrigger><SelectValue placeholder="Select academic year" /></SelectTrigger>
                  <SelectContent>
                    {academicYearOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                {/* Read-only - auto-resolved from Course Catalog's own
                    regulation batches for this course & year. Never picked
                    manually here. */}
                <div className="flex h-9 items-center gap-1.5 rounded-md border bg-muted/30 px-3">
                  {!selectedYear ? (
                    <span className="text-sm text-muted-foreground">Pick a year first</span>
                  ) : allowedRegulations.length === 0 ? (
                    <span className="text-sm text-muted-foreground">None assigned</span>
                  ) : (
                    allowedRegulations.map((r) => (
                      <Badge key={r} variant="secondary" className="text-xs">
                        {r}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {selectedDepartment && !isLoadingCourses && courses.length === 0 && (
            <p className="text-sm text-muted-foreground px-1">
              No courses have been set up for {selectedDepartment.name} yet.
            </p>
          )}

          {selectedCourse && selectedYear && selectedDepartment && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {selectedDepartment.name} · {selectedCourse.name} · {ordinalYear(Number(selectedYear))}
                  </h2>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/dean/subjects/import?departmentId=${selectedDepartmentId}&courseId=${selectedCourseId}&year=${selectedYear}&academicYear=${encodeURIComponent(selectedAcademicYear)}&department=${encodeURIComponent(selectedDepartment.name)}&courseName=${encodeURIComponent(selectedCourse.name)}`)}
                    >
                      <Upload className="h-4 w-4 mr-2" />Import Subjects
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => router.push(`/dean/subjects/new?departmentId=${selectedDepartmentId}&courseId=${selectedCourseId}&year=${selectedYear}&academicYear=${encodeURIComponent(selectedAcademicYear)}&department=${encodeURIComponent(selectedDepartment.name)}&regulation=${encodeURIComponent(singleRegulation)}&nextSerialNumber=${nextSerialNumber}&catalogId=${encodeURIComponent(selectedCourse.catalogId ?? "")}`)}
                    >
                      <Plus className="h-4 w-4 mr-2" />Add Subject
                    </Button>
                  </div>
                </div>

                {isLoadingSubjects ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
                  </div>
                ) : subjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No subjects added yet for this year.
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
                            <th className="px-4 py-3" />
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {sortedSubjects.map((s) => (
                            <tr key={s.id}>
                              <td className="px-4 py-2.5">{s.serialNumber ?? "—"}</td>
                              <td className="px-4 py-2.5">
                                {s.category ? <Badge variant="outline" className="text-xs">{s.category === "OTHER" ? (s.customCategory || "Other") : s.category}</Badge> : "—"}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-foreground">{s.name}</div>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <Badge variant="secondary" className="text-xs font-mono">{s.code}</Badge>
                                  <Badge variant="outline" className="text-xs">{SUBJECT_TYPE_LABELS[s.type]}</Badge>
                                  {s.regulation && <Badge variant="secondary" className="text-xs">{s.regulation}</Badge>}
                                  {s.academicYear && <Badge variant="outline" className="text-xs">{s.academicYear}</Badge>}
                                  <span className="text-xs text-muted-foreground">{s.hoursPerWeek} hrs/week</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-center">{s.lectureHours ?? "—"}</td>
                              <td className="px-4 py-2.5 text-center">{s.tutorialHours ?? "—"}</td>
                              <td className="px-4 py-2.5 text-center">{s.practicalHours ?? "—"}</td>
                              <td className="px-4 py-2.5 text-center">{s.credits}</td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => router.push(`/dean/subjects/${s.id}/edit?departmentId=${selectedDepartmentId}&courseId=${selectedCourseId}&year=${selectedYear}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(singleRegulation)}`)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(s)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "subject"}?`}
        description="This will permanently remove the subject."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
