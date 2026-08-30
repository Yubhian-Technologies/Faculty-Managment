"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import type { Course, CourseCatalogItem, Department, Subject } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";
import { fedYears, regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";
import { deriveHodScope, managerEffectiveYears } from "@/lib/departments/hodScope";
import { parseAcademicYearStart } from "@/lib/college/academicSession";

const ALL_REGULATIONS = "__all__"; // sentinel: Radix Select items can't use an empty string value

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function HODSubjectsPage() {
  const router = useRouter();
  const myDepartments = useMyDepartments();
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  // Course Catalog entries (regulations/regulationBatches per course) - the
  // Regulation picker below is sourced from here, same as HOD Sections' own
  // regulation picker (hod/sections/new/page.tsx), rather than only from
  // whatever subjects happen to already exist for this course/year.
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  // The college's own configured current session, when a Principal has set
  // one (Settings > Academic Year) - used only to resolve which regulation
  // batch currently occupies the selected year (same pattern as HOD
  // Sections' currentSessionStart). Falls back to the plain date-based
  // session when nothing's configured yet.
  const [currentSessionStart, setCurrentSessionStart] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  // Explicit picks only - "" means "no override yet, use the default below".
  // Keeping these separate from the effective values actually shown avoids
  // needing an effect to sync state just to pick a default.
  const [pickedCourseId, setPickedCourseId] = useState("");
  const [pickedYear, setPickedYear] = useState("");
  // "" means "All regulations" - lets an HOD tell apart subjects filed under
  // different curriculum regulations when a year has more than one active
  // (e.g. a transition batch).
  const [pickedRegulation, setPickedRegulation] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);

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

  // Each department owns its own course row for the same catalog programme
  // (e.g. Basic Science's and CIVIL's own "Bachelor of Technology"), and each
  // carries its own distinct subject list - so, unlike Sections, these can't
  // be merged into one choice. Append the owning department's name whenever
  // more than one course shares a display name, so they read as distinct
  // options instead of confusing duplicates.
  const courseNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of courses) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    return counts;
  }, [courses]);
  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const courseLabel = useCallback(
    (c: Course) => (courseNameCounts.get(c.name) ?? 0) > 1
      ? `${c.name} — ${deptNameById.get(c.departmentId) ?? "?"}`
      : c.name,
    [courseNameCounts, deptNameById]
  );

  // Default straight to the first course/year - Course/Year stay switchable
  // via the pickers below for departments with more than one, but the HOD
  // shouldn't have to click through both just to see subjects that are
  // almost always already there.
  const selectedCourseId = pickedCourseId || courses[0]?.id || "";
  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) ?? null, [courses, selectedCourseId]);
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
  // Never the raw 1..durationYears span - only the years the Principal
  // actually assigned this HOD's own scope for this course (per-course
  // override included, via managerEffectiveYears). A year some OTHER
  // department already claims as a feeder for this scope (fedYears) is
  // excluded even from the "nothing assigned yet" fallback, so an
  // unconfigured department doesn't wrongly offer a shared year that
  // structurally belongs to someone else.
  const yearOptions = useMemo(() => {
    if (!selectedCourse) return [];
    const courseYears = Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1);
    const assigned = new Set<number>();
    const excluded = new Set<number>();
    for (const d of ownScopeDepartments) {
      for (const y of managerEffectiveYears(d, departments, selectedCourse.catalogId)) assigned.add(y);
      for (const y of fedYears(d, departments, selectedCourse.catalogId)) excluded.add(y);
    }
    const base = assigned.size > 0 ? courseYears.filter((y) => assigned.has(y)) : courseYears;
    return base.filter((y) => !excluded.has(y));
  }, [selectedCourse, ownScopeDepartments, departments]);
  const selectedYear = pickedYear || (yearOptions.length > 0 ? String(yearOptions[0]) : "");

  const selectedCatalogItem = useMemo(
    () => catalogItems.find((c) => c.id === selectedCourse?.catalogId) ?? null,
    [catalogItems, selectedCourse]
  );
  // Sourced from the Course Catalog (same resolution HOD Sections' and Dean
  // Subjects' own regulation pickers use), unioned with whatever's already
  // on this course/year's saved subjects - so a regulation the Dean just
  // configured shows up even before any subject uses it (this control used
  // to be a post-hoc filter over already-loaded subjects, which meant an
  // empty subject list always meant an empty, disabled dropdown with no
  // explanation why), while a legacy/edge-case subject the catalog can no
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
  const regulationOptions = useMemo(
    () => Array.from(new Set([
      ...catalogRegulations,
      ...subjects.map((s) => s.regulation).filter((r): r is string => !!r),
    ])).sort(),
    [catalogRegulations, subjects]
  );
  const regulationEmptyReason = useMemo(() => {
    if (regulationOptions.length > 0) return null;
    if (!selectedCourse?.catalogId) return "This course isn't linked to a Course Catalog entry.";
    return "No regulation is configured for this year yet — set one in Course Catalog (Dean).";
  }, [regulationOptions, selectedCourse]);
  const visibleSubjects = useMemo(() => {
    const filtered = pickedRegulation ? subjects.filter((s) => !s.regulation || s.regulation === pickedRegulation) : subjects;
    // Curriculum-table order: by S.No. when set, falling back to name for
    // legacy subjects that predate the field.
    return [...filtered].sort((a, b) => {
      if (a.serialNumber != null && b.serialNumber != null) return a.serialNumber - b.serialNumber;
      if (a.serialNumber != null) return -1;
      if (b.serialNumber != null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [subjects, pickedRegulation]);

  const loadSubjects = useCallback(async (courseId: string, year: string) => {
    if (!courseId || !year) { setSubjects([]); return; }
    setIsLoadingSubjects(true);
    try {
      const res = await fetch(`/api/college/subjects?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`);
      const data = await res.json() as { subjects: Subject[] };
      setSubjects(data.subjects ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingSubjects(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await loadSubjects(selectedCourseId, selectedYear); })();
  }, [selectedCourseId, selectedYear, loadSubjects]);

  function selectCourse(courseId: string) {
    setPickedCourseId(courseId);
    setPickedYear(""); // fall back to the new course's own first year
    setPickedRegulation("");
  }

  function selectYear(year: string) {
    setPickedYear(year);
    setPickedRegulation("");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete subject");
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      await loadSubjects(selectedCourseId, selectedYear);
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
        description="Manage subjects offered for each year of your department's courses - common to all sections of that year"
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
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={selectedCourseId} onValueChange={selectCourse}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{courseLabel(c)}</SelectItem>)}
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
                <Select
                  value={pickedRegulation || ALL_REGULATIONS}
                  onValueChange={(v) => setPickedRegulation(v === ALL_REGULATIONS ? "" : v)}
                  disabled={regulationOptions.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder="All regulations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_REGULATIONS}>All regulations</SelectItem>
                    {regulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                {regulationEmptyReason && (
                  <p className="text-xs text-muted-foreground">{regulationEmptyReason}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedCourseId && selectedYear && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  {selectedCourse ? courseLabel(selectedCourse) : ""} · {ordinalYear(Number(selectedYear))}
                </h2>

                {isLoadingSubjects ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
                  </div>
                ) : subjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No subjects added yet for this year.
                  </p>
                ) : visibleSubjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No subjects for this year under regulation {pickedRegulation}.
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
                          {visibleSubjects.map((s) => {
                            // A subject viewed here that isn't actually filed under
                            // this HOD's own department (e.g. Basic Science's shared
                            // 1st-year subject, seen from a fed department like IT)
                            // is read-only - editing/deleting it from a department
                            // that doesn't own it would change/remove it for every
                            // other department sharing it too.
                            const isOwnDepartment = !!s.department && myDepartments.includes(s.department);
                            return (
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
                                    {!isOwnDepartment && (
                                      <Badge variant="outline" className="text-xs">From {s.department}</Badge>
                                    )}
                                    <span className="text-xs text-muted-foreground">{s.hoursPerWeek} hrs/week</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-center">{s.lectureHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{s.tutorialHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{s.practicalHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{s.credits}</td>
                                <td className="px-4 py-2.5 text-right">
                                  {isOwnDepartment && (
                                    <div className="flex justify-end gap-1">
                                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(`/hod/subjects/${s.id}/edit?courseId=${selectedCourseId}&year=${selectedYear}`)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(s)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  )}
                                </td>
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
