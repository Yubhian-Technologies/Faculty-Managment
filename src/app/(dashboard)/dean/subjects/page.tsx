"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Plus, Pencil, Trash2 } from "lucide-react";
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
import { academicSessionLabel, currentAcademicStartYear } from "@/lib/college/academicSession";
import { resolveDepartmentCourseScope, regulationsForYear } from "@/lib/college/academicStructure";

const ALL_REGULATIONS = "__all__"; // sentinel: Radix Select items can't use an empty string value

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
  // Course Catalog entries, keyed by which regulations the Principal assigned
  // to each (see CourseCatalogSettingsCard) - a course's OWN assigned subset,
  // not the college's full declared list, gates which regulation a subject
  // for it may use.
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  // Calendar academic session (e.g. "2026-27") a subject is tagged with when
  // the Dean adds it - defaults to the current session, not required to change.
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicSessionLabel(currentAcademicStartYear()));
  // Curriculum regulation (e.g. "R20", "R23") to browse/segregate subjects
  // by - "" means "All" (subjects across every regulation, badge-labelled).
  // Auto-picked once a year is chosen when this course only allows exactly
  // one regulation for it (see selectYear), but stays freely switchable.
  const [selectedRegulation, setSelectedRegulation] = useState("");

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
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load course catalog" }));
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
  // This course's own assigned regulations (Course Catalog > Regulations),
  // narrowed to whichever are actually offered for the selected year
  // (regulationYears) - the set a subject for this year may use. Empty means
  // nothing's assigned for this year yet, which blocks adding subjects here
  // (see subjects POST).
  const allowedRegulations = useMemo(() => {
    const catalogItem = selectedCourse?.catalogId ? catalogItems.find((c) => c.id === selectedCourse.catalogId) : null;
    return selectedYear ? regulationsForYear(catalogItem, Number(selectedYear)) : (catalogItem?.regulations ?? []);
  }, [selectedCourse, catalogItems, selectedYear]);

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
      // The API also includes a feeder department's own course row when the
      // selected department is fed by it (e.g. Basic Science's shared B.Tech
      // row shows up under CSE too) - legitimate for the roles/pages that
      // need to browse a fed department's shared-year courses inline, but
      // here it just produces a same-named duplicate with no way to tell
      // which is which, and picking it doesn't work anyway (Year options
      // below are scoped to the DEPARTMENT picked above, not to whichever
      // duplicate course row was picked, so the feeder's own reserved
      // year(s) never become selectable). Drop anything not actually owned
      // by the picked department - to add subjects for the feeder itself
      // (e.g. Basic Science's 1st Year), pick it directly in the Department
      // dropdown above instead, which already works correctly.
      const list = (data.courses ?? [])
        .filter((c) => c.isActive && c.departmentId === departmentId)
        .sort((a, b) => a.name.localeCompare(b.name));
      setCourses(list);
      return list;
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
      return [];
    } finally {
      setIsLoadingCourses(false);
    }
  }, []);

  // Deliberately NOT filtered by academic session (academicYear) - a
  // regulation's year-N curriculum is the same subject list no matter which
  // session you're browsing under, so a batch's juniors see exactly what
  // their seniors saw. academicYear is still stamped on each subject at
  // creation time (shown as a badge) purely as a record of when it was
  // entered, never as a visibility gate.
  const loadSubjects = useCallback(async (departmentName: string, courseId: string, year: string, regulation: string) => {
    if (!departmentName || !courseId || !year) { setSubjects([]); return; }
    setIsLoadingSubjects(true);
    try {
      const res = await fetch(
        `/api/college/subjects?department=${encodeURIComponent(departmentName)}&courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}${regulation ? `&regulation=${encodeURIComponent(regulation)}` : ""}`
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
    const regulation = searchParams.get("regulation") ?? "";
    if (!departmentId) return;
    const dept = departments.find((d) => d.id === departmentId);
    if (!dept) return;
    void (async () => {
      setSelectedDepartmentId(departmentId);
      setSelectedAcademicYear(academicYear);
      setSelectedRegulation(regulation);
      const list = await loadCourses(departmentId);
      if (courseId && list.some((c) => c.id === courseId)) {
        setSelectedCourseId(courseId);
        if (year) {
          setSelectedYear(year);
          await loadSubjects(dept.name, courseId, year, regulation);
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
    // Auto-pick this course's own regulation for this year when it's
    // unambiguous (exactly one applies, per Course Catalog's regulationYears)
    // - otherwise fall back to "All", switchable right after via its own
    // picker. Computed inline against `year` rather than reading the
    // allowedRegulations memo, which still reflects the OLD selectedYear at
    // this point in the same render.
    const catalogItem = selectedCourse?.catalogId ? catalogItems.find((c) => c.id === selectedCourse.catalogId) : null;
    const regulationsForThisYear = regulationsForYear(catalogItem, Number(year));
    const regulation = regulationsForThisYear.length === 1 ? regulationsForThisYear[0] : "";
    setSelectedRegulation(regulation);
    if (selectedDepartment) void loadSubjects(selectedDepartment.name, selectedCourseId, year, regulation);
  }

  function selectRegulation(regulation: string) {
    const value = regulation === ALL_REGULATIONS ? "" : regulation;
    setSelectedRegulation(value);
    if (selectedDepartment && selectedYear) void loadSubjects(selectedDepartment.name, selectedCourseId, selectedYear, value);
  }

  async function handleDelete() {
    if (!deleteTarget || !selectedDepartment) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete subject");
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      await loadSubjects(selectedDepartment.name, selectedCourseId, selectedYear, selectedRegulation);
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
                <Label>Regulation</Label>
                <Select value={selectedRegulation || ALL_REGULATIONS} onValueChange={selectRegulation} disabled={!selectedYear}>
                  <SelectTrigger><SelectValue placeholder="All regulations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_REGULATIONS}>All regulations</SelectItem>
                    {allowedRegulations.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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

          {selectedCourse && selectedYear && selectedDepartment && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {selectedDepartment.name} · {selectedCourse.name} · {ordinalYear(Number(selectedYear))}
                  </h2>
                  <Button
                    size="sm"
                    disabled={allowedRegulations.length === 0}
                    onClick={() => router.push(`/dean/subjects/new?departmentId=${selectedDepartmentId}&courseId=${selectedCourseId}&year=${selectedYear}&academicYear=${encodeURIComponent(selectedAcademicYear)}&department=${encodeURIComponent(selectedDepartment.name)}&regulation=${encodeURIComponent(selectedRegulation)}&nextSerialNumber=${nextSerialNumber}&catalogId=${encodeURIComponent(selectedCourse.catalogId ?? "")}`)}
                  >
                    <Plus className="h-4 w-4 mr-2" />Add Subject
                  </Button>
                </div>

                {allowedRegulations.length === 0 && (
                  <p className="text-sm text-amber-600 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    {selectedCourse.name} has no regulations assigned yet. Ask the Principal to assign at least one under Settings &gt; Course Catalog before adding subjects.
                  </p>
                )}

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
                                    onClick={() => router.push(`/dean/subjects/${s.id}/edit?departmentId=${selectedDepartmentId}&courseId=${selectedCourseId}&year=${selectedYear}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(selectedRegulation)}`)}
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
