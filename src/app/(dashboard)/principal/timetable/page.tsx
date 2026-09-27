"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import type { Course, Department, Section, CourseYearTiming, TimetableSlot } from "@/types";

// Read-only view of PUBLISHED timetables for the Principal and Vice Principal.
// Reads `timetableSlots`, which only ever contains published slots - drafts live
// in a separate collection, so an in-progress timetable can never appear here.
// VICE_PRINCIPAL reaches this page through its inherited access to /principal/*
// (see ROLE_PATH_MAP in src/proxy.ts).

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function PrincipalTimetablePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // A Course doc belongs to one department, so the same programme (e.g. B.Tech)
  // exists as a separate doc per branch. The picker selects by course NAME first,
  // then the department narrows it to one concrete courseId.
  const [courseName, setCourseName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState<number | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  // Derived rather than a separate flag: a synchronous setIsLoading(true) inside
  // the fetch effect would be a cascading render (react-hooks/set-state-in-effect).
  const [loadedFor, setLoadedFor] = useState("");
  const isLoadingGrid = Boolean(sectionId) && loadedFor !== sectionId;
  // Monday of the week currently on screen - navigable via WeekNavigator,
  // defaulting to this calendar week. weekDates pairs positionally with
  // DAYS above, labelling each column with its actual date.
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);
  const weekDates = useMemo(() => currentWeekDates(weekStart), [weekStart]);

  /** Cascading selects clear their downstream state here, not inside an effect. */
  function resetBelowCourse() {
    setDepartmentId("");
    setYear("");
    setSemester(null);
    setSections([]);
    setSectionId("");
    setTiming(null);
    setSlots([]);
  }
  function chooseCourseName(name: string) {
    setCourseName(name);
    resetBelowCourse();
  }
  function chooseDepartment(id: string) {
    setDepartmentId(id);
    setYear("");
    setSemester(null);
    setSections([]);
    setSectionId("");
    setTiming(null);
    setSlots([]);
  }
  function chooseYear(y: string) {
    setYear(y);
    setSemester(null);
    setSections([]);
    setSectionId("");
    setTiming(null);
    setSlots([]);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [c, d] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        ]);
        if (cancelled) return;
        setCourses((c.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
        setDepartments(d.departments ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Distinct course names across every department.
  const courseNames = Array.from(new Set(courses.map((c) => c.name))).sort((a, b) => a.localeCompare(b));
  // Departments that actually offer the chosen course name.
  const departmentsForCourse = courseName
    ? departments
        .filter((d) => courses.some((c) => c.name === courseName && c.departmentId === d.id))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  // The one concrete Course doc the two selections resolve to.
  const course = courses.find((c) => c.name === courseName && c.departmentId === departmentId) ?? null;
  const courseId = course?.id ?? "";
  // Scoped to the picked department's own "Years Taught" for this course
  // (resolveDepartmentCourseScope), not the raw 1..durationYears span - e.g.
  // Basic Science only ever published a 1st-year timetable for a shared
  // 4-year B.Tech course, so 2nd-4th shouldn't even be offered here.
  const yearOptions = (() => {
    if (!course) return [];
    const courseYears = Array.from({ length: course.durationYears }, (_, i) => i + 1);
    const dept = departments.find((d) => d.id === departmentId);
    const assigned = dept ? resolveDepartmentCourseScope(dept, course.catalogId).assignedYears : [];
    return assigned.length > 0 ? courseYears.filter((y) => assigned.includes(y)) : courseYears;
  })();

  const semesterOptions = useMemo(() => {
    if (!timing) return [];
    const sems = timing.semesters;
    return sems ? sems.map((s) => s.semester).sort((a, b) => a - b) : [];
  }, [timing]);
  const effectiveSemester = semesterOptions.length === 0
    ? null
    : semester != null && semesterOptions.includes(semester)
      ? semester
      : semesterOptions[0];

  // Sections + timing for the resolved course-year. Downstream state is cleared
  // by the choose* handlers, so this effect never has to reset anything itself.
  //
  // Sections are fetched by DEPARTMENT (not the resolved courseId) because a
  // shared first-year department (e.g. "Basic Science") never has any section
  // filed against its own Course doc - sections created through the
  // managed-branch flow store the real branch's own courseId/department
  // instead (see hod/sections/new). /api/college/sections?departmentId=
  // resolves this the same way the HOD Sections page already does
  // (deriveHodScope), so picking "Basic Science" here correctly reaches its
  // real branches' sections. Results are still narrowed to the chosen course
  // NAME client-side, in case the department in scope runs more than one
  // differently-named program for the same year.
  useEffect(() => {
    if (!departmentId || !year) return;
    let cancelled = false;
    void (async () => {
      try {
        const [s, t] = await Promise.all([
          fetch(`/api/college/sections?departmentId=${encodeURIComponent(departmentId)}&year=${encodeURIComponent(year)}${effectiveSemester != null ? "&semester=" + effectiveSemester : ""}`)
            .then((r) => r.json() as Promise<{ sections: Section[] }>),
          fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
            .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
        ]);
        if (cancelled) return;
        const courseIdsForName = new Set(courses.filter((c) => c.name === courseName).map((c) => c.id));
        const list = (s.sections ?? [])
          .filter((sec) => courseIdsForName.has(sec.courseId))
          .sort((a, b) => a.name.localeCompare(b.name));
        setSections(list);
        setSectionId(list[0]?.id ?? "");
        setTiming((t.timings ?? []).find((x) => Number(x.year) === Number(year)) ?? null);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      }
    })();
    return () => { cancelled = true; };
  }, [departmentId, year, effectiveSemester, courseId, courseName, courses]);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}&week=${isoDateKey(weekStart)}${effectiveSemester != null ? "&semester=" + effectiveSemester : ""}`)
          .then((r) => r.json() as Promise<{ slots: TimetableSlot[] }>);
        if (cancelled) return;
        setSlots(d.slots ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load timetable" });
      } finally {
        if (!cancelled) setLoadedFor(sectionId);
      }
    })();
    return () => { cancelled = true; };
  }, [sectionId, weekStart, effectiveSemester]);

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Timetable" description="Published section timetables across the college" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="tt-course">Course</label>
          <select
            id="tt-course"
            className={selectClass}
            value={courseName}
            onChange={(e) => chooseCourseName(e.target.value)}
            disabled={isLoading}
          >
            <option value="">Select a course</option>
            {courseNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="tt-department">Department</label>
          <select
            id="tt-department"
            className={selectClass}
            value={departmentId}
            onChange={(e) => chooseDepartment(e.target.value)}
            disabled={!courseName}
          >
            <option value="">
              {courseName && departmentsForCourse.length === 0 ? "No departments" : "Select a department"}
            </option>
            {departmentsForCourse.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="tt-year">Year</label>
          <select
            id="tt-year"
            className={selectClass}
            value={year}
            onChange={(e) => chooseYear(e.target.value)}
            disabled={!course}
          >
            <option value="">Select a year</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{ordinalYear(y)}</option>
            ))}
          </select>
        </div>

<div className="space-y-1.5">
           <label className="text-sm font-medium" htmlFor="tt-semester">Semester</label>
           <select
             id="tt-semester"
             className={selectClass}
             value={effectiveSemester != null ? String(effectiveSemester) : ""}
             onChange={(e) => setSemester(Number(e.target.value))}
             disabled={!timing || semesterOptions.length === 0}
           >
             <option value="">Select semester</option>
             {semesterOptions.map((s) => (
               <option key={s} value={s}>Semester {s}</option>
             ))}
           </select>
         </div>

         <div className="space-y-1.5">
           <label className="text-sm font-medium" htmlFor="tt-section">Section</label>
           <select
             id="tt-section"
             className={selectClass}
             value={sectionId}
             onChange={(e) => setSectionId(e.target.value)}
             disabled={sections.length === 0}
           >
             {sections.length === 0 ? <option value="">No sections</option> : null}
             {/* Department code included: a parent department and its
                 sub-departments each have their own "A". */}
             {sections.map((s) => (
               <option key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</option>
             ))}
           </select>
         </div>
      </div>

      {!sectionId ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Pick a course, department, year and section to view its published timetable.
        </div>
      ) : isLoadingGrid ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Period timings haven&rsquo;t been configured for this course year yet.
        </div>
      ) : slots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No timetable has been published for this section yet. The HOD builds and publishes it from their Timetable page.
        </div>
      ) : (
        <InstitutionalTimetableTable
          section={sections.find((s) => s.id === sectionId)}
          timing={timing}
          slots={slots}
          courseName={courseName}
          departmentName={departments.find((d) => d.id === departmentId)?.name}
          academicYear={slots[0]?.academicYear}
          semesterLabel={semester ? `Semester ${semester}` : undefined}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          showWeekNav={true}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
        />
      )}
    </div>
  );
}
