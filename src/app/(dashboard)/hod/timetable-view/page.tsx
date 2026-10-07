"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { FacultyLeisureFilter } from "@/components/timetable/FacultyLeisureFilter";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { toast } from "@/hooks/useToast";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { ordinalYear } from "@/lib/timetable/gridModel";
import type { Course, CourseYearTiming, DayOfWeek, Department, Section, Subject, TimetableSlot } from "@/types";
import { yearSemesterLabelIn } from "@/lib/academic/format";
import { offeredYearsAcross } from "@/lib/college/departmentYears";
import { useAuthStore } from "@/store/authStore";
import { useWorkContext } from "@/hooks/useWorkContext";
import { departmentOfContext } from "@/lib/roles/activeHodDepartment";

// Read-only, download-only counterpart of /hod/timetable (the editor): year ->
// semester -> section, then Load shows the published timetable, with PDF/Excel
// download from the grid.
// /api/college/sections already scopes an HOD to their own department, its
// sub-departments and managed branches, so the years and sections offered here
// are exactly the ones this HOD owns - no client-side scope logic needed.

export default function HODTimetableViewPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState<number | null>(null);
  const [sectionId, setSectionId] = useState("");
  // This year's timings per courseId, fetched when a year is chosen so the
  // Semester picker can come BEFORE the Section picker.
  const [timings, setTimings] = useState<Record<string, CourseYearTiming | null>>({});
  // What Load asked for; the grid below only ever shows this, never the live
  // pickers, so changing a filter clears it until Load is clicked again.
  const [request, setRequest] = useState<{ sectionId: string; semester: number | null } | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [loadedFor, setLoadedFor] = useState("");
  const [showLeisure, setShowLeisure] = useState(false);
  const user = useAuthStore((st) => st.user);
  const { active } = useWorkContext();
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

  // The years this HOD's departments are ASSIGNED, not the years their
  // sections happen to sit in. A department given years 2-4 used to still
  // offer year 1 whenever one shared first-year section was filed under it,
  // and one given a year it had not created sections for yet offered nothing.
  //
  // /api/college/sections is already role-scoped, so the department names on
  // those sections are exactly this HOD's tree - that is what decides whose
  // assigned years to union here. Falls back to the sections' own years for a
  // department nobody has configured yet.
  // This HOD's OWN department - whichever they are "working as" when they head
  // more than one, else all of them.
  //
  // NOT the departments their sections belong to. A managing department runs
  // branches whose sections are filed under the BRANCH (Basic Science teaches
  // the shared first year of data science, ECE and the rest, and those
  // sections say "data science"). Unioning the branches' assigned years gave
  // the Basic Science HOD years 2-4 - the branches' own years - and dropped
  // the one year she actually runs.
  const ownDepartmentNames = useMemo(() => {
    const picked = departmentOfContext(active);
    if (picked) return [picked];
    return user?.departments ?? (user?.department ? [user.department] : []);
  }, [active, user]);

  const years = useMemo(() => {
    const sectionYears = sections.map((s) => Number(s.year));
    const catalogId = courses.find((c) => sections.some((s) => s.courseId === c.id))?.catalogId;
    const baseYears = offeredYearsAcross(ownDepartmentNames, departments, catalogId, sectionYears);
    const allYears = Array.from(new Set([...baseYears, ...sectionYears]))
      .filter((y) => Number.isFinite(y) && y >= 1)
      .sort((a, b) => a - b);
    return allYears.length > 0 ? allYears : [1, 2, 3, 4];
  }, [sections, departments, courses, ownDepartmentNames]);
  const yearSections = useMemo(() => sections.filter((s) => String(s.year) === year), [sections, year]);

  // Timings are per course-year, keyed by the SECTION's own courseId (a shared
  // first-year section is filed under its real branch's Course doc).
  useEffect(() => {
    if (!year) return;
    const courseIds = Array.from(new Set(sections.map((s) => s.courseId))).filter(Boolean);
    if (courseIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseIds.join(","))}`);
        const data = (await res.json()) as { timings: CourseYearTiming[] };
        const allTimings = data.timings ?? [];
        const entries = courseIds.map((id) => [
          id,
          allTimings.find((x) => x.courseId === id && Number(x.year) === Number(year)) ?? null,
        ] as const);
        if (!cancelled) setTimings(Object.fromEntries(entries));
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load period timings" });
      }
    })();
    return () => { cancelled = true; };
  }, [year, sections]);

  // `timings` already holds only the chosen year's entry per course, so the
  // semesters are read straight off it rather than through that year's
  // sections - which may legitimately be none.
  const semesterOptions = useMemo(
    () => Array.from(new Set(
      Object.values(timings).flatMap((t) => (t?.semesters ?? []).map((x) => x.semester))
    )).sort((a, b) => a - b),
    [timings]
  );
  // A chosen semester narrows the sections to the course-years that run it.
  const sectionsForPick = useMemo(
    () =>
      yearSections
        .filter((s) => {
          const sems = (timings[s.courseId]?.semesters ?? []).map((x) => x.semester);
          return semester == null || sems.length === 0 || sems.includes(semester);
        })
        .sort((a, b) => sectionDisplayLabel(a, departments).localeCompare(sectionDisplayLabel(b, departments))),
    [yearSections, semester, timings, departments]
  );

  const loadedSection = request ? sections.find((s) => s.id === request.sectionId) ?? null : null;
  const timing = loadedSection ? timings[loadedSection.courseId] ?? null : null;
  const course = loadedSection ? courses.find((c) => c.id === loadedSection.courseId) : undefined;
  const loadedSemester = request?.semester ?? null;
  const gridKey = request ? `${request.sectionId}|${isoDateKey(weekStart)}|${loadedSemester ?? ""}` : "";
  const isLoadingGrid = Boolean(request) && loadedFor !== gridKey;

  function chooseYear(y: string) {
    setYear(y);
    setSemester(null);
    setSectionId("");
    setRequest(null);
    setTimings({});
  }
  function chooseSemester(v: string) {
    setSemester(v ? Number(v) : null);
    setSectionId("");
    setRequest(null);
  }
  function chooseSection(id: string) {
    setSectionId(id);
    setRequest(null);
  }
  function load() {
    if (!sectionId || (semesterOptions.length > 0 && semester == null)) return;
    setSlots([]);
    setRequest({ sectionId, semester });
  }

  useEffect(() => {
    if (!request) return;
    const key = gridKey;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(request.sectionId)}&week=${isoDateKey(weekStart)}${request.semester != null ? "&semester=" + request.semester : ""}`)
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
  }, [request, weekStart, gridKey]);

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
          <label className="text-sm font-medium" htmlFor="ttv-semester">Semester</label>
          <select
            id="ttv-semester"
            className={selectClass}
            value={semester != null ? String(semester) : ""}
            onChange={(e) => chooseSemester(e.target.value)}
            disabled={!year || semesterOptions.length === 0}
          >
            <option value="">{!year ? "Select a year" : semesterOptions.length === 0 ? "No semesters" : "Select semester"}</option>
            {semesterOptions.map((n) => <option key={n} value={n}>{yearSemesterLabelIn(Number(year), semesterOptions, n)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="ttv-section">Section</label>
          <select id="ttv-section" className={selectClass} value={sectionId} onChange={(e) => chooseSection(e.target.value)} disabled={!year}>
            <option value="">
              {!year ? "Select a year" : sectionsForPick.length === 0 ? "No sections for this year yet" : "Select a section"}
            </option>
            {sectionsForPick.map((s) => (
              <option key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            className="h-9 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            onClick={load}
            disabled={!sectionId || (semesterOptions.length > 0 && semester == null)}
          >
            Load
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
          onClick={() => setShowLeisure((v) => !v)}
        >
          {showLeisure ? "Hide leisure faculty" : "Show leisure faculty"}
        </button>
        {showLeisure && <FacultyLeisureFilter scopeLabel="in your department" />}
      </div>

      {!request ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Pick a year, semester and section, then click Load to view its published timetable.
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
          section={loadedSection}
          timing={timing}
          slots={slots}
          courseName={course?.name}
          departmentName={departments.find((d) => d.name === loadedSection?.department)?.name ?? loadedSection?.department}
          academicYear={slots[0]?.academicYear}
          semesterLabel={loadedSemester != null ? `Sem ${yearSemesterLabelIn(Number(year), semesterOptions, loadedSemester)}` : undefined}
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
