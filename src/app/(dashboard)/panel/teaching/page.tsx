"use client";

import { useEffect, useState } from "react";
import { Clock, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import type { TeachingAssignment, TimetableSlot, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

// Grid instead of a per-subject card list: a faculty member thinks in terms
// of "what am I teaching on Monday period 3", not a flat list of subjects, so
// this lays their own slots out the same way the HOD/Principal Timetable
// pages do (Day columns x Period rows). Unlike those pages, this never picks
// a single CourseYearTiming - a faculty member's own slots can span several
// course-years with different period configs - so rows are period NUMBERS
// only, no clock times.

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function TeachingLoadPage() {
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/college/teaching-assignments");
        if (!res.ok) throw new Error("Failed to load teaching assignments");
        const json = await res.json() as {
          assignments: TeachingAssignment[];
          timetableSlots: TimetableSlot[];
        };
        setAssignments(json.assignments ?? []);
        setTimetableSlots(json.timetableSlots ?? []);
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
                    const subline = [
                      assignment?.courseName,
                      assignment?.year ? ordinalYear(assignment.year) : null,
                      assignment?.sectionName ? `Section ${assignment.sectionName}` : null,
                    ].filter(Boolean).join(" · ");
                    return (
                      <td key={d} className="p-2 align-top">
                        {slot ? (
                          <div className="rounded-md border bg-primary/5 border-primary/20 p-2">
                            <p className="text-xs font-semibold leading-tight">{slot.subjectName}</p>
                            {subline && <p className="text-[11px] text-muted-foreground mt-0.5">{subline}</p>}
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
