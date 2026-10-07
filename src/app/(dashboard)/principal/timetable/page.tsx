"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { FacultyLeisureFilter } from "@/components/timetable/FacultyLeisureFilter";
import { TeachingNowFilter } from "@/components/timetable/TeachingNowFilter";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { resolveTaughtYears } from "@/lib/college/taughtYears";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { ordinalYear } from "@/lib/timetable/gridModel";
import type { Course, Department, Section, CourseYearTiming, TimetableSlot, Subject, DayOfWeek } from "@/types";
import { yearSemesterLabelIn } from "@/lib/academic/format";

// Read-only view of PUBLISHED timetables for the Principal and Vice Principal.
// Reads `timetableSlots`, which only ever contains published slots - drafts live
// in a separate collection, so an in-progress timetable can never appear here.
// VICE_PRINCIPAL reaches this page through its inherited access to /principal/*
// (see ROLE_PATH_MAP in src/proxy.ts).

// The college-wide "who is free at this time" filter is an optional toggle. The
// page is re-exported for Academics, which does not get it (the
// /api/college/faculty-leisure guard enforces the real role list). Hidden for Academics only; a "working as" seat can change user.role, so this
// is a denylist rather than an allowlist.
const NO_LEISURE_ROLES = ["ACADEMICS"];
// "Teaching at this time" is for the Principal, Vice Principal and admins only
// (api/college/teaching-now enforces the real list). This page is also
// re-exported for Exam Cell and Academics, who do not get it. A denylist for
// the same reason as above: a "working as" seat can change user.role.
const NO_TEACHING_NOW_ROLES = ["ACADEMICS", "EXAM_CELL"];

export default function PrincipalTimetablePage() {
  const { user } = useAuth();
  const canSeeLeisure = !NO_LEISURE_ROLES.includes(user?.role ?? "");
  const canSeeTeachingNow = !!user && !NO_TEACHING_NOW_ROLES.includes(user.role);
  const [panel, setPanel] = useState<"" | "leisure" | "teaching">("");
  const showLeisure = panel === "leisure";
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
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  // Derived rather than a separate flag: a synchronous setIsLoading(true) inside
  // the fetch effect would be a cascading render (react-hooks/set-state-in-effect).
  const [loadedFor, setLoadedFor] = useState("");
  // What the Load button last asked for. Changing any filter clears it, so the
  // grid never shows a section the filters no longer describe, and nothing is
  // fetched while the user is still choosing.
  const [applied, setApplied] = useState<{ sectionId: string; semester: number | null } | null>(null);
  const appliedKey = applied ? `${applied.sectionId}|${applied.semester ?? ""}` : "";
  const isLoadingGrid = Boolean(appliedKey) && loadedFor !== appliedKey;
  // Monday of the week currently on screen - navigable via WeekNavigator,
  // defaulting to this calendar week. weekDates pairs positionally with
  // DAYS above, labelling each column with its actual date.
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);
  const weekDates = useMemo(() => currentWeekDates(weekStart), [weekStart]);

  /** Cascading selects clear their downstream state here, not inside an effect. */
  function resetBelowCourse() {
    setApplied(null);
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
    setApplied(null);
    setDepartmentId(id);
    setYear("");
    setSemester(null);
    setSections([]);
    setSectionId("");
    setTiming(null);
    setSlots([]);
  }
  function chooseYear(y: string) {
    setApplied(null);
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
    // Own years, or - for a sub-department that has none of its own - its parent's. An empty result means the
    // department isn't configured: no years (never every year of the course).
    const assigned = dept ? resolveTaughtYears(dept, departments, course.catalogId).years : [];
    return courseYears.filter((y) => assigned.includes(y));
  })();

  const visibleSections = sections;

  const semesterOptions = useMemo(() => {
    if (!timing) return [];
    const sems = timing.semesters;
    return sems ? sems.map((s) => s.semester).sort((a, b) => a - b) : [];
  }, [timing]);
  // No auto-pick: until a semester is chosen the API resolves the current one.
  const effectiveSemester = semester != null && semesterOptions.includes(semester) ? semester : null;

  // Sections + timing for the resolved course-year. Deliberately NOT keyed on the
  // semester: sections belong to a course-year, and refetching on a semester
  // change reset the picked section (and raced the timing load). Downstream state is cleared
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
          fetch(`/api/college/sections?departmentId=${encodeURIComponent(departmentId)}&year=${encodeURIComponent(year)}`)
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
            setSectionId("");
        setTiming((t.timings ?? []).find((x) => Number(x.year) === Number(year)) ?? null);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      }
    })();
    return () => { cancelled = true; };
  }, [departmentId, year, courseId, courseName, courses]);

  useEffect(() => {
    if (!applied) return;
    const { sectionId: appliedSection, semester: appliedSemester } = applied;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(appliedSection)}&week=${isoDateKey(weekStart)}${appliedSemester != null ? "&semester=" + appliedSemester : ""}`)
          .then((r) => r.json() as Promise<{ slots: TimetableSlot[]; subjects?: Subject[]; workingDays?: DayOfWeek[] }>);
        if (cancelled) return;
        setSlots(d.slots ?? []);
        setSubjects(d.subjects ?? []);
        setWorkingDays(d.workingDays ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load timetable" });
      } finally {
        if (!cancelled) setLoadedFor(`${appliedSection}|${appliedSemester ?? ""}`);
      }
    })();
    return () => { cancelled = true; };
  }, [applied, weekStart]);

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Timetable View" description="Published section timetables across the college" />

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
             onChange={(e) => { setApplied(null); setSemester(e.target.value ? Number(e.target.value) : null); }}
             disabled={!timing || semesterOptions.length === 0}
           >
             <option value="">Select semester</option>
             {semesterOptions.map((s) => (
               <option key={s} value={s}>{yearSemesterLabelIn(Number(year), semesterOptions, s)}</option>
             ))}
           </select>
         </div>

         <div className="space-y-1.5">
           <label className="text-sm font-medium" htmlFor="tt-section">Section</label>
           <select
             id="tt-section"
             className={selectClass}
             value={sectionId}
             onChange={(e) => { setApplied(null); setSectionId(e.target.value); }}
             disabled={visibleSections.length === 0}
           >
             <option value="">{visibleSections.length === 0 ? "No sections" : "Select a section"}</option>
             {/* Department code included: a parent department and its
                 sub-departments each have their own "A". */}
             {visibleSections.map((s) => (
               <option key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</option>
             ))}
           </select>
         </div>

         <div className="space-y-1.5 flex flex-col justify-end">
           <Button onClick={() => setApplied({ sectionId, semester: effectiveSemester })} disabled={!sectionId}>
             <Search className="h-4 w-4 mr-2" />{applied ? "Reload Timetable" : "Load Timetable"}
           </Button>
         </div>
      </div>

      {canSeeLeisure && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
              onClick={() => setPanel((v) => (v === "leisure" ? "" : "leisure"))}
            >
              {showLeisure ? "Hide leisure faculty" : "Show leisure faculty"}
            </button>
            {canSeeTeachingNow && (
              <button
                type="button"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
                onClick={() => setPanel((v) => (v === "teaching" ? "" : "teaching"))}
              >
                {panel === "teaching" ? "Hide teaching at this time" : "Teaching at this time"}
              </button>
            )}
          </div>
          {showLeisure && <FacultyLeisureFilter />}
          {panel === "teaching" && canSeeTeachingNow && <TeachingNowFilter />}
        </div>
      )}

      {!applied ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Pick a course, department, year and section, then press Load Timetable.
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
          semesterLabel={semester ? `Sem ${yearSemesterLabelIn(Number(year), semesterOptions, Number(semester))}` : undefined}
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
