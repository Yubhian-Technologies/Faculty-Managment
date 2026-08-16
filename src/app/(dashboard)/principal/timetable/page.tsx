"use client";

import { useEffect, useState } from "react";
import { Coffee, Utensils } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import { buildRows } from "@/lib/timetable/buildGrid";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import type { Course, Department, Section, CourseYearTiming, TimetableSlot, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

// Read-only view of PUBLISHED timetables for the Principal and Vice Principal.
// Reads `timetableSlots`, which only ever contains published slots - drafts live
// in a separate collection, so an in-progress timetable can never appear here.
// VICE_PRINCIPAL reaches this page through its inherited access to /principal/*
// (see ROLE_PATH_MAP in src/proxy.ts).

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

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
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Derived rather than a separate flag: a synchronous setIsLoading(true) inside
  // the fetch effect would be a cascading render (react-hooks/set-state-in-effect).
  const [loadedFor, setLoadedFor] = useState("");
  const isLoadingGrid = Boolean(sectionId) && loadedFor !== sectionId;

  /** Cascading selects clear their downstream state here, not inside an effect. */
  function resetBelowCourse() {
    setDepartmentId("");
    setYear("");
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
    setSections([]);
    setSectionId("");
    setTiming(null);
    setSlots([]);
  }
  function chooseYear(y: string) {
    setYear(y);
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

  // Sections + timing for the resolved course-year. Downstream state is cleared
  // by the choose* handlers, so this effect never has to reset anything itself.
  useEffect(() => {
    if (!courseId || !year) return;
    let cancelled = false;
    void (async () => {
      try {
        const [s, t] = await Promise.all([
          fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
            .then((r) => r.json() as Promise<{ sections: Section[] }>),
          fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
            .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
        ]);
        if (cancelled) return;
        const list = (s.sections ?? []).sort((a, b) => a.name.localeCompare(b.name));
        setSections(list);
        setSectionId(list[0]?.id ?? "");
        setTiming((t.timings ?? []).find((x) => Number(x.year) === Number(year)) ?? null);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, year]);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}`)
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
  }, [sectionId]);

  const rows = timing ? buildRows(timing) : [];
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
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-24">Period</th>
                {DAYS.map((d) => (
                  <th key={d} className="p-2.5 text-left font-medium text-muted-foreground border-b min-w-35">
                    {DAY_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.kind === "lunch" || row.kind === "short") {
                  const Icon = row.kind === "lunch" ? Utensils : Coffee;
                  const label = row.kind === "lunch" ? "Lunch Break" : "Short Break";
                  return (
                    <tr key={`break_${idx}`} className="bg-amber-50/60">
                      <td colSpan={DAYS.length + 1} className="p-2 text-center text-xs font-medium text-amber-700">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5" />{label} · {row.durationMinutes} min
                        </span>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={`period_${row.period}`} className="border-b last:border-b-0">
                    <td className="p-2.5 font-medium text-muted-foreground">{row.period}</td>
                    {DAYS.map((d) => {
                      const slot = slots.find((s) => s.day === d && s.periodNumber === row.period);
                      return (
                        <td key={d} className="p-2 align-top">
                          {slot ? (
                            <div className="rounded-md border bg-primary/5 border-primary/20 p-2">
                              <p className="text-xs font-semibold leading-tight">{slot.subjectName}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{slot.facultyName}</p>
                              {slot.classroom && <p className="text-[11px] text-muted-foreground">{slot.classroom}</p>}
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">-</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
