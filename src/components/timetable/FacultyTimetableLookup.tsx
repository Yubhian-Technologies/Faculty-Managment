"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarSearch, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import type { DayOfWeek, Department, PeriodTiming } from "@/types";
import { DAY_LABELS } from "@/types";
import { toRoman } from "@/lib/timetable/gridModel";

const WORKING_DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];


interface ScheduleSlot {
  day: DayOfWeek;
  periodNumber: number;
  subjectName: string;
  courseName: string;
  departmentName: string;
  year: number;
  sectionName: string;
  /** Built but not yet published - still occupies the faculty (see the API). */
  isDraft: boolean;
  /** Marked busy by the lending department of an Assignment Request - no section/subject of its own. */
  isDeclared?: boolean;
  declaredFor?: string;
}

// Checks a faculty member's real schedule before sending/allocating a lend
// request, or before marking their busy periods (see AssignmentRequestsPanel) -
// read-only, and deliberately able to look at ANY department's faculty (see
// api/college/faculty-schedule's own doc-comment on why that's a separate,
// narrower endpoint from the department-scoped faculty roster).
//
// Department and Faculty pick WHO, and that is all that is asked for: the grid
// is laid out against the faculty's OWN course-years (the API returns the
// periods), so the Course and Year pickers - which existed only to shape the
// table - are gone. They made the page look like it needed four answers to
// show one person's week.
//
// A cell is "busy" purely by matching day+period NUMBER
// against the faculty's real slots, the same convention busyFaculty/
// FacultyAssignmentRequest.busyPeriods already use everywhere else - not a
// clock-time translation.
// `embedded`: rendered inside another page (the Timetable editor) - no page
// header, and nothing shown until a faculty is picked.
export function FacultyTimetableLookup({ ownOnly = false, embedded = false }: { ownOnly?: boolean; embedded?: boolean } = {}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  const [departmentId, setDepartmentId] = useState<string>("");
  const [facultyId, setFacultyId] = useState<string>("");

  const [facultyOptions, setFacultyOptions] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingFaculty, setIsLoadingFaculty] = useState(false);

  const [schedule, setSchedule] = useState<{ facultyName: string; slots: ScheduleSlot[]; periods: PeriodTiming[] } | null>(null);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);

  useEffect(() => {
    if (ownOnly) return;
    void (async () => {
      setIsLoadingOptions(true);
      try {
        const deptRes = await fetch("/api/college/departments");
        const deptJson = await deptRes.json() as { departments?: Department[] };
        setDepartments(deptJson.departments ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load departments" });
      } finally {
        setIsLoadingOptions(false);
      }
    })();
  }, [ownOnly]);

  // Faculty picker resets whenever the department changes.
  useEffect(() => {
    if (ownOnly) return;
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
  }, [departmentId, ownOnly]);

  // The faculty's real schedule, and the periods to lay it out against.
  useEffect(() => {
    void (async () => {
      if (!ownOnly && !facultyId) { setSchedule(null); return; }
      setIsLoadingSchedule(true);
      try {
        const res = await fetch(`/api/college/faculty-schedule?${ownOnly ? "me=1" : `facultyId=${encodeURIComponent(facultyId)}`}`);
        const json = await res.json() as { facultyName?: string; slots?: ScheduleSlot[]; periods?: PeriodTiming[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load schedule");
        setSchedule({ facultyName: json.facultyName ?? "", slots: json.slots ?? [], periods: json.periods ?? [] });
      } catch (err) {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load schedule" });
        setSchedule(null);
      } finally {
        setIsLoadingSchedule(false);
      }
    })();
  }, [facultyId, ownOnly]);

  const periodTimes = schedule?.periods ?? [];

  const slotsByCell = useMemo(() => {
    const map = new Map<string, ScheduleSlot>();
    for (const s of schedule?.slots ?? []) map.set(`${s.day}:${s.periodNumber}`, s);
    return map;
  }, [schedule]);

  const readyForGrid = Boolean((ownOnly || facultyId) && schedule && periodTimes.length > 0);

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title={ownOnly ? "My Timetable" : "Faculty Timetable"}
          description={ownOnly
            ? "Your real weekly schedule - every period you are booked for, across every course and section"
            : "Look up any department's faculty and their real schedule - read-only, useful before sending or allocating an Assignment Request, or marking busy periods"}
        />
      )}

      {!ownOnly && <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>
        </CardContent>
      </Card>}

      {(!ownOnly && !facultyId) || !schedule ? (
        embedded && !isLoadingSchedule ? null : <EmptyState
          icon={<CalendarSearch className="h-8 w-8" />}
          title={isLoadingSchedule ? "Loading…" : ownOnly ? "No timetable found" : "Pick a department and a faculty member"}
          description="Their real week shows here - every period they are already booked for, across every course and section."
        />
      ) : !readyForGrid ? (
        // No periods to draw means no course-year timings AND no bookings -
        // said plainly rather than rendering an empty table.
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {schedule.facultyName} has no periods booked, and no period timings are configured for their course-years yet.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              {schedule.facultyName} &mdash; {schedule.slots.length} period{schedule.slots.length === 1 ? "" : "s"} booked this week
            </p>
            {schedule.slots.some((sl) => sl.isDraft) && (
              <p className="text-xs text-muted-foreground">
                Dashed cells are from a timetable that has been built but not published yet.
              </p>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] table-fixed text-sm border-collapse">
              {/* Column heads are plain P1, P2, ... - booked cells carry only
                  "III · CSE-A", so the period comes from the column. Clock
                  times stay off: they differ per year. */}
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-2 w-14 sticky left-0 z-[5] bg-muted/95" aria-label="Day" />
                  {periodTimes.map((p) => (
                    <th key={p.period} className="p-2 text-center text-[11px] font-bold text-foreground">
                      P{p.period}
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
                        <td key={p.period} className="p-1.5 align-top">
                          {slot ? (
                            // Its own period number, year and section. The
                            // subject, course and department are what the
                            // section's own timetable is for - here the
                            // question is just "is this hour taken, and by
                            // whose class".
                            <div
                              className={`flex items-start gap-1 rounded-md border bg-red-50 px-1.5 py-1.5 ${
                                slot.isDraft ? "border-dashed border-red-300" : "border-red-300"
                              }`}
                              title={[slot.departmentName, slot.courseName, slot.subjectName].filter(Boolean).join(" · ")}
                            >
                              <X className="h-3.5 w-3.5 shrink-0 text-red-600 mt-[1px]" />
                              {/* Compact "III · CSE-A": roman year and the section
                                  name, on one line. The period is the column
                                  heading (P1, P2, ...), not repeated here.
                                  Declared busy slots show their target department. */}
                              <p className="min-w-0 text-[11px] font-semibold text-red-800 leading-snug">
                                {slot.isDeclared
                                  ? `Marked busy${slot.declaredFor ? ` for ${slot.declaredFor}` : ""}`
                                  : [toRoman(slot.year), slot.sectionName || null].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed px-2 py-1.5 text-center text-[11px] text-emerald-700 bg-emerald-50/50">
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
