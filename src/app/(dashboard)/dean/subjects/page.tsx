"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Plus, Pencil, Trash2, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { AcademicRegulationSettings, Course, Department, Subject } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";
import { academicSessionLabel, currentAcademicStartYear, recentAcademicSessions } from "@/lib/college/academicSession";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";

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
  // Fixed once by the Principal under Settings (see RegulationSettingsCard) -
  // loaded once here and looked up by year below, purely for display.
  const [regulationSettings, setRegulationSettings] = useState<AcademicRegulationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  // Calendar academic session (e.g. "2026-27") a subject is tagged with when
  // the Dean adds it - defaults to the current session, not required to change.
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicSessionLabel(currentAcademicStartYear()));

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

    fetch("/api/college/settings/regulations")
      .then((r) => r.json() as Promise<{ settings: AcademicRegulationSettings }>)
      .then((d) => setRegulationSettings(d.settings))
      .catch(() => {}); // purely informational - no error state needed if this fails
  }, []);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === selectedDepartmentId) ?? null,
    [departments, selectedDepartmentId]
  );
  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) ?? null, [courses, selectedCourseId]);
  // Scoped to the picked department's own "Years Taught" for this course
  // (resolveDepartmentCourseScope), not the raw 1..durationYears span - e.g.
  // Basic Science only offers 1st Year even though its shared B.Tech course
  // spans 4.
  const yearOptions = useMemo(() => {
    if (!selectedCourse || !selectedDepartment) return [];
    const courseYears = Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1);
    const assigned = resolveDepartmentCourseScope(selectedDepartment, selectedCourse.catalogId).assignedYears;
    return assigned.length > 0 ? courseYears.filter((y) => assigned.includes(y)) : courseYears;
  }, [selectedCourse, selectedDepartment]);
  const currentRegulation = selectedYear ? regulationSettings?.yearRegulations?.[selectedYear] : undefined;

  const loadCourses = useCallback(async (departmentId: string) => {
    setIsLoadingCourses(true);
    try {
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
      const data = await res.json() as { courses: Course[] };
      const list = (data.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name));
      setCourses(list);
      return list;
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
      return [];
    } finally {
      setIsLoadingCourses(false);
    }
  }, []);

  const loadSubjects = useCallback(async (departmentName: string, courseId: string, year: string, academicYear: string) => {
    if (!departmentName || !courseId || !year) { setSubjects([]); return; }
    setIsLoadingSubjects(true);
    try {
      const res = await fetch(
        `/api/college/subjects?department=${encodeURIComponent(departmentName)}&courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}&academicYear=${encodeURIComponent(academicYear)}`
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

  function selectYear(year: string) {
    setSelectedYear(year);
    if (selectedDepartment) void loadSubjects(selectedDepartment.name, selectedCourseId, year, selectedAcademicYear);
  }

  function selectAcademicYear(academicYear: string) {
    setSelectedAcademicYear(academicYear);
    if (selectedDepartment && selectedYear) void loadSubjects(selectedDepartment.name, selectedCourseId, selectedYear, academicYear);
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
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                <Label>Year</Label>
                <Select value={selectedYear} onValueChange={selectYear} disabled={!selectedCourse}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Academic Year</Label>
                <Select value={selectedAcademicYear} onValueChange={selectAcademicYear}>
                  <SelectTrigger><SelectValue placeholder="Select academic year" /></SelectTrigger>
                  <SelectContent>
                    {recentAcademicSessions().map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {selectedDepartment && !isLoadingCourses && courses.length === 0 && (
            <p className="text-sm text-muted-foreground px-1">
              No courses have been set up for {selectedDepartment.name} yet.
            </p>
          )}

          {selectedCourse && selectedYear && selectedDepartment && selectedAcademicYear && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {selectedDepartment.name} · {selectedCourse.name} · {ordinalYear(Number(selectedYear))} · {selectedAcademicYear}
                    {/* Fixed by the Principal under Settings for this year of study - see RegulationSettingsCard. */}
                    {currentRegulation ? (
                      <Badge variant="secondary" className="text-xs font-normal">Regulation {currentRegulation}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs font-normal text-muted-foreground">Regulation not fixed</Badge>
                    )}
                  </h2>
                  <Button
                    size="sm"
                    onClick={() => router.push(`/dean/subjects/new?departmentId=${selectedDepartmentId}&courseId=${selectedCourseId}&year=${selectedYear}&academicYear=${encodeURIComponent(selectedAcademicYear)}&department=${encodeURIComponent(selectedDepartment.name)}`)}
                  >
                    <Plus className="h-4 w-4 mr-2" />Add Subject
                  </Button>
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
                  <div className="space-y-2">
                    {subjects.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant="secondary" className="text-xs font-mono">{s.code}</Badge>
                            <Badge variant="outline" className="text-xs">{SUBJECT_TYPE_LABELS[s.type]}</Badge>
                            {s.academicYear && <Badge variant="outline" className="text-xs">{s.academicYear}</Badge>}
                          </div>
                          <p className="font-medium text-sm">{s.name}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.hoursPerWeek} hrs/week</span>
                            {s.totalHoursPerSemester != null && <span>{s.totalHoursPerSemester} hrs/semester</span>}
                            {s.credits > 0 && <span>{s.credits} credits</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => router.push(`/dean/subjects/${s.id}/edit?departmentId=${selectedDepartmentId}&courseId=${selectedCourseId}&year=${selectedYear}&academicYear=${encodeURIComponent(selectedAcademicYear)}`)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(s)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
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
