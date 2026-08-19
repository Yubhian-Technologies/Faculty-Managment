"use client";

import { useEffect, useState } from "react";
import { Clock, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import type { TeachingAssignment, TimetableSlot, DayOfWeek, CourseYearTiming, PeriodTiming } from "@/types";
import { DAY_LABELS } from "@/types";

// Grid instead of a per-subject card list: a faculty member thinks in terms
// of "what am I teaching on Monday period 3", not a flat list of subjects, so
// this lays their own slots out the same way the HOD/Principal Timetable
// pages do (Day columns x Period rows). Unlike those pages, this never picks
// a single CourseYearTiming for the whole grid - a faculty member's own slots
// can span several course-years with different period configs (e.g. 1st Year
// runs shorter periods than 3rd Year), so the leading "Period" column stays a
// plain number, and each occupied cell resolves its own clock time from ITS
// slot's courseId+year instead - two cells in the same period row can (and
// often do) show different times.

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "09:00" -> "9:00 AM" - display only. */
function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function TeachingLoadPage() {
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const [assignRes, timingsRes] = await Promise.all([
          fetch("/api/college/teaching-assignments"),
          // No courseId filter - a faculty's own slots can span several
          // courses/years, so this needs every course-year's timing to
          // resolve clock times cell by cell (see periodTimeFor below).
          fetch("/api/college/course-year-timings"),
        ]);
        if (!assignRes.ok) throw new Error("Failed to load teaching assignments");
        const json = await assignRes.json() as {
          assignments: TeachingAssignment[];
          timetableSlots: TimetableSlot[];
        };
        setAssignments(json.assignments ?? []);
        setTimetableSlots(json.timetableSlots ?? []);
        if (timingsRes.ok) {
          const timingsJson = await timingsRes.json() as { timings: CourseYearTiming[] };
          setTimings(timingsJson.timings ?? []);
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load teaching load" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const totalHoursPerWeek = assignments.reduce((sum, a) => sum + (a.hoursPerWeek ?? 0), 0);
  const subjectCount = assignments.length;
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const maxPeriod = timetableSlots.reduce((max, s) => Math.max(max, s.periodNumber), 0);
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

  // Each course-year's own period-by-period breakdown, resolved once up
  // front (falls back to the plain numberOfPeriods/periodDurationMinutes
  // formula for a course-year the HOD hasn't broken down yet - same
  // fallback the HOD/Principal Timetable pages use).
  const periodsByCourseYear = new Map<string, PeriodTiming[]>(
    timings.map((t) => [
      `${t.courseId}_${t.year}`,
      t.periods && t.periods.length > 0 ? t.periods : defaultPeriodTimings(t),
    ]),
  );
  function periodTimeFor(courseId: string | undefined, year: number | undefined, period: number) {
    if (!courseId || !year) return undefined;
    return periodsByCourseYear.get(`${courseId}_${year}`)?.find((p) => p.period === period);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Teaching Load"
          description="Assigned subjects and your weekly timetable, period by period"
        />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Load"
        description="Assigned subjects and your weekly timetable, period by period"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Layers className="h-8 w-8 text-indigo-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Subjects</p>
              <p className="text-2xl font-bold mt-1">{subjectCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Hours / Week</p>
              <p className="text-2xl font-bold mt-1">{totalHoursPerWeek}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {periods.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No timetable slots have been published for you yet.
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
              {periods.map((period) => (
                <tr key={period} className="border-b last:border-b-0">
                  <td className="p-2.5 font-medium text-muted-foreground">{period}</td>
                  {DAYS.map((d) => {
                    const slot = timetableSlots.find((s) => s.day === d && s.periodNumber === period);
                    const assignment = slot ? assignmentById.get(slot.assignmentId) : undefined;
                    // Resolved from this slot's OWN course+year, not a shared
                    // row-level time - a period "3" in a 1st Year section can
                    // run a different clock time than period "3" in a 3rd
                    // Year one, so this must vary cell by cell, not row by row.
                    const time = slot ? periodTimeFor(slot.courseId, slot.year, slot.periodNumber) : undefined;
                    const subline = [
                      assignment?.courseName,
                      assignment?.year ? ordinalYear(assignment.year) : null,
                      assignment?.sectionName ? `Section ${assignment.sectionName}` : null,
                    ].filter(Boolean).join(" · ");
                    return (
                      <td key={d} className="p-2 align-top">
                        {slot ? (
                          <div className={`rounded-md border p-2 ${slot.substituteFacultyName || slot.substituteForName ? "bg-amber-50 border-amber-200" : "bg-primary/5 border-primary/20"}`}>
                            {time && (
                              <p className="text-[10px] font-medium text-muted-foreground/80 mb-0.5">
                                {formatTime12h(time.startTime)}&ndash;{formatTime12h(time.endTime)}
                              </p>
                            )}
                            <p className="text-xs font-semibold leading-tight">{slot.subjectName}</p>
                            {slot.substituteFacultyName ? (
                              <p className="text-[11px] font-medium text-amber-700 mt-0.5">Covered by {slot.substituteFacultyName}</p>
                            ) : slot.substituteForName ? (
                              <p className="text-[11px] font-medium text-amber-700 mt-0.5">Substituting for {slot.substituteForName}</p>
                            ) : (
                              subline && <p className="text-[11px] text-muted-foreground mt-0.5">{subline}</p>
                            )}
                            {slot.classroom && <p className="text-[11px] text-muted-foreground">{slot.classroom}</p>}
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">-</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
