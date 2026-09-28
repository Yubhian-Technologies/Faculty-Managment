"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarSearch } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
import type { Course, CourseYearTiming, DayOfWeek, Department } from "@/types";
import { DAY_LABELS } from "@/types";

const WORKING_DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

interface ScheduleSlot {
  day: DayOfWeek;
  periodNumber: number;
  subjectName: string;
  courseName: string;
  year: number;
  sectionName: string;
}

// Checks a faculty member's real schedule before sending/allocating a lend
// request, or before marking their busy periods (see AssignmentRequestsPanel) -
// read-only, and deliberately able to look at ANY department's faculty (see
// api/college/faculty-schedule's own doc-comment on why that's a separate,
// narrower endpoint from the department-scoped faculty roster). Department
// and Faculty pick WHO; Course and Year only pick which period structure
// (count + clock times) to lay the grid out with - the viewer's own
// accessible courses, since that's the timetable they'd actually be placing
// periods against. A cell is "busy" purely by matching day+period NUMBER
// against the faculty's real slots, the same convention busyFaculty/
// FacultyAssignmentRequest.busyPeriods already use everywhere else - not a
// clock-time translation.
export function FacultyTimetableLookup() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  const [departmentId, setDepartmentId] = useState<string>("");
  const [facultyId, setFacultyId] = useState<string>("");
  const [courseId, setCourseId] = useState<string>("");
  const [year, setYear] = useState<number | null>(null);

  const [facultyOptions, setFacultyOptions] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingFaculty, setIsLoadingFaculty] = useState(false);

  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [isLoadingTiming, setIsLoadingTiming] = useState(false);

  const [schedule, setSchedule] = useState<{ facultyName: string; slots: ScheduleSlot[] } | null>(null);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);

  const selectedCourse = courses.find((c) => c.id === courseId) ?? null;

  useEffect(() => {
    void (async () => {
      setIsLoadingOptions(true);
      try {
        const [deptRes, courseRes] = await Promise.all([
          fetch("/api/college/departments"),
          fetch("/api/college/courses"),
        ]);
        const deptJson = await deptRes.json() as { departments?: Department[] };
        const courseJson = await courseRes.json() as { courses?: Course[] };
        setDepartments(deptJson.departments ?? []);
        setCourses(courseJson.courses ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load departments/courses" });
      } finally {
        setIsLoadingOptions(false);
      }
    })();
  }, []);

  // Faculty picker resets whenever the department changes.
  useEffect(() => {
    void (async () => {
      setFacultyId("");
      setSchedule(null);
      if (!departmentId) { setFacultyOptions([]); return; }
      setIsLoadingFaculty(true);
      try {
        const res = await fetch(`/api/college/faculty-schedule?departmentId=${encodeURIComponent(departmentId)}`);
        const json = await res.json() as { faculty?: { id: string; name: string }[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load faculty");
        setFacultyOptions(json.faculty ?? []);
      } catch (err) {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load faculty" });
        setFacultyOptions([]);
      } finally {
        setIsLoadingFaculty(false);
      }
    })();
  }, [departmentId]);

  // Year picker resets whenever the course changes; timing loads once both are picked.
  useEffect(() => {
    void (async () => {
      setYear(null);
      setTiming(null);
    })();
  }, [courseId]);

  useEffect(() => {
    void (async () => {
      if (!courseId || year == null) { setTiming(null); return; }
      setIsLoadingTiming(true);
      try {
        const res = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`);
        const json = await res.json() as { timings?: CourseYearTiming[] };
        setTiming((json.timings ?? []).find((t) => Number(t.year) === year) ?? null);
      } catch {
        toast({ variant: "destructive", title: "Failed to load period timings" });
      } finally {
        setIsLoadingTiming(false);
      }
    })();
  }, [courseId, year]);

  // The faculty's real schedule loads once a faculty is picked - independent
  // of course/year (that only decides how the grid is laid out on screen).
  useEffect(() => {
    void (async () => {
      if (!facultyId) { setSchedule(null); return; }
      setIsLoadingSchedule(true);
      try {
        const res = await fetch(`/api/college/faculty-schedule?facultyId=${encodeURIComponent(facultyId)}`);
        const json = await res.json() as { facultyName?: string; slots?: ScheduleSlot[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load schedule");
        setSchedule({ facultyName: json.facultyName ?? "", slots: json.slots ?? [] });
      } catch (err) {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load schedule" });
        setSchedule(null);
      } finally {
        setIsLoadingSchedule(false);
      }
    })();
  }, [facultyId]);

  const periodTimes = useMemo(() => {
    if (!timing) return [];
    return timing.periods && timing.periods.length > 0 ? timing.periods : defaultPeriodTimings(timing);
  }, [timing]);

  const slotsByCell = useMemo(() => {
    const map = new Map<string, ScheduleSlot>();
    for (const s of schedule?.slots ?? []) map.set(`${s.day}:${s.periodNumber}`, s);
    return map;
  }, [schedule]);

  const readyForGrid = Boolean(facultyId && timing);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Timetable"
        description="Look up any department's faculty and their real schedule - read-only, useful before sending or allocating an Assignment Request, or marking busy periods"
      />

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Department</p>
              <Select value={departmentId} onValueChange={setDepartmentId} disabled={isLoadingOptions}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Faculty</p>
              <Select value={facultyId} onValueChange={setFacultyId} disabled={!departmentId || isLoadingFaculty}>
                <SelectTrigger>
                  <SelectValue placeholder={!departmentId ? "Pick a department first" : isLoadingFaculty ? "Loading…" : "Select faculty"} />
                </SelectTrigger>
                <SelectContent>
                  {facultyOptions.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Course</p>
              <Select value={courseId} onValueChange={setCourseId} disabled={isLoadingOptions}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Year</p>
              <Select
                value={year != null ? String(year) : ""}
                onValueChange={(v) => setYear(Number(v))}
                disabled={!selectedCourse}
              >
                <SelectTrigger>
                  <SelectValue placeholder={!selectedCourse ? "Pick a course first" : "Select year"} />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: selectedCourse?.durationYears ?? 0 }, (_, i) => i + 1).map((y) => (
                    <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!readyForGrid ? (
        <EmptyState
          icon={<CalendarSearch className="h-8 w-8" />}
          title={isLoadingSchedule || isLoadingTiming ? "Loading…" : "Pick a department, faculty, course and year"}
          description="Once all four are selected, that faculty's real schedule shows here, laid out against the course-year's own periods."
        />
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No period timings are configured for {selectedCourse?.name} - {ordinalYear(year!)} yet.
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">
            {schedule?.facultyName} - against {selectedCourse?.name} {ordinalYear(year!)}&apos;s own periods
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-20 sticky left-0 z-[5] bg-muted/95 backdrop-blur">
                    Day
                  </th>
                  {periodTimes.map((p) => (
                    <th key={p.period} className="p-2.5 text-center font-medium text-muted-foreground border-b min-w-[110px]">
                      Period {p.period}
                      <p className="text-[10px] font-normal whitespace-nowrap">
                        {formatTime12h(p.startTime)}&ndash;{formatTime12h(p.endTime)}
                      </p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WORKING_DAYS.map((d) => (
                  <tr key={d} className="border-b last:border-b-0">
                    <td className="p-2.5 font-medium text-muted-foreground sticky left-0 z-[5] bg-background">
                      {DAY_LABELS[d]}
                    </td>
                    {periodTimes.map((p) => {
                      const slot = slotsByCell.get(`${d}:${p.period}`);
                      return (
                        <td key={p.period} className="p-2 align-top">
                          {slot ? (
                            <div className="rounded-md border border-amber-300 bg-amber-50 p-2">
                              <p className="text-xs font-semibold text-amber-900 leading-tight">{slot.subjectName}</p>
                              <p className="text-[11px] text-amber-700 mt-0.5">
                                {[slot.courseName, ordinalYear(slot.year), slot.sectionName ? `Section ${slot.sectionName}` : null]
                                  .filter(Boolean).join(" · ")}
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed p-2 text-center text-[11px] text-emerald-700 bg-emerald-50/50">
                              Free
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
