"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { toast } from "@/hooks/useToast";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { ordinalYear } from "@/lib/timetable/gridModel";
import type { Course, CourseYearTiming, DayOfWeek, Department, Section, Subject, TimetableSlot } from "@/types";

// Read-only, download-only counterpart of /hod/timetable (the editor): year ->
// section -> the published timetable, with PDF/Excel download from the grid.
// /api/college/sections already scopes an HOD to their own department, its
// sub-departments and managed branches, so the years and sections offered here
// are exactly the ones this HOD owns - no client-side scope logic needed.

export default function HODTimetableViewPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [year, setYear] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [batch, setBatch] = useState("");
  const [semester, setSemester] = useState<number | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [loadedFor, setLoadedFor] = useState("");
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, c, d] = await Promise.all([
          fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: Section[] }>),
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        ]);
        if (cancelled) return;
        setSections(s.sections ?? []);
        setCourses(c.courses ?? []);
        setDepartments(d.departments ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const years = useMemo(
    () => Array.from(new Set(sections.map((s) => Number(s.year)))).sort((a, b) => a - b),
    [sections]
  );
  const batchOptions = useMemo(
    () => Array.from(new Set(sections.filter((s) => String(s.year) === year).map((s) => s.batch).filter(Boolean))).sort(),
    [sections, year]
  );
  const sectionsForYear = useMemo(
    () =>
      sections
        .filter((s) => String(s.year) === year && (!batch || s.batch === batch))
        .sort((a, b) => sectionDisplayLabel(a, departments).localeCompare(sectionDisplayLabel(b, departments))),
    [sections, year, batch, departments]
  );
  const section = sections.find((s) => s.id === sectionId) ?? null;
  const course = section ? courses.find((c) => c.id === section.courseId) : undefined;
  // Only present when the section's course-year has semesters configured.
  const semesterOptions = useMemo(
    () => (timing?.semesters ?? []).map((x) => x.semester).sort((a, b) => a - b),
    [timing]
  );
  const effectiveSemester = semesterOptions.length === 0
    ? null
    : semester != null && semesterOptions.includes(semester) ? semester : semesterOptions[0];
  const gridKey = `${sectionId}|${isoDateKey(weekStart)}|${effectiveSemester ?? ""}`;
  const isLoadingGrid = Boolean(sectionId) && loadedFor !== gridKey;

  function chooseYear(y: string) {
    setYear(y);
    setBatch("");
    setSemester(null);
    setSectionId("");
    setTiming(null);
    setSlots([]);
  }
  function chooseBatch(b: string) {
    setBatch(b);
    setSemester(null);
    setSectionId("");
    setTiming(null);
    setSlots([]);
  }
  function chooseSection(id: string) {
    setSectionId(id);
    setSemester(null);
    setTiming(null);
    setSlots([]);
  }

  // Timings are per course-year, keyed by the SECTION's own courseId (a shared
  // first-year section is filed under its real branch's Course doc).
  useEffect(() => {
    if (!section) return;
    let cancelled = false;
    void (async () => {
      try {
        const t = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(section.courseId)}`)
          .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>);
        if (!cancelled) setTiming((t.timings ?? []).find((x) => Number(x.year) === Number(section.year)) ?? null);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load period timings" });
      }
    })();
    return () => { cancelled = true; };
  }, [section]);

  useEffect(() => {
    if (!sectionId) return;
    const key = gridKey;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}&week=${isoDateKey(weekStart)}${effectiveSemester != null ? "&semester=" + effectiveSemester : ""}`)
          .then((r) => r.json() as Promise<{ slots: TimetableSlot[]; subjects?: Subject[]; workingDays?: DayOfWeek[] }>);
        if (cancelled) return;
        setSlots(d.slots ?? []);
        setSubjects(d.subjects ?? []);
        setWorkingDays(d.workingDays ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load timetable" });
      } finally {
        if (!cancelled) setLoadedFor(key);
      }
    })();
    return () => { cancelled = true; };
  }, [sectionId, weekStart, effectiveSemester, gridKey]);

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Timetable View" description="View and download published timetables for your sections" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="ttv-year">Year</label>
          <select id="ttv-year" className={selectClass} value={year} onChange={(e) => chooseYear(e.target.value)} disabled={isLoading}>
            <option value="">{!isLoading && years.length === 0 ? "No sections" : "Select a year"}</option>
            {years.map((y) => <option key={y} value={y}>{ordinalYear(y)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="ttv-batch">Batch</label>
          <select id="ttv-batch" className={selectClass} value={batch} onChange={(e) => chooseBatch(e.target.value)} disabled={!year || batchOptions.length === 0}>
            <option value="">All batches</option>
            {batchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="ttv-section">Section</label>
          <select id="ttv-section" className={selectClass} value={sectionId} onChange={(e) => chooseSection(e.target.value)} disabled={!year}>
            <option value="">Select a section</option>
            {sectionsForYear.map((s) => (
              <option key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="ttv-semester">Semester</label>
          <select
            id="ttv-semester"
            className={selectClass}
            value={effectiveSemester != null ? String(effectiveSemester) : ""}
            onChange={(e) => setSemester(Number(e.target.value))}
            disabled={!timing || semesterOptions.length === 0}
          >
            <option value="">{!timing ? "Select a section" : "No semesters"}</option>
            {semesterOptions.map((n) => <option key={n} value={n}>Semester {n}</option>)}
          </select>
        </div>
      </div>

      {!sectionId ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Pick a year and section to view its published timetable.
        </div>
      ) : isLoadingGrid ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Period timings haven&rsquo;t been configured for this course year yet.
        </div>
      ) : slots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No timetable has been published for this section yet. Publish it from the Timetable page.
        </div>
      ) : (
        <InstitutionalTimetableTable
          section={section}
          timing={timing}
          slots={slots}
          courseName={course?.name}
          departmentName={departments.find((d) => d.name === section?.department)?.name ?? section?.department}
          academicYear={slots[0]?.academicYear}
          semesterLabel={effectiveSemester != null ? `Semester ${effectiveSemester}` : undefined}
          workingDays={workingDays}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          showWeekNav={true}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          subjects={subjects}
        />
      )}
    </div>
  );
}
