"use client";

import { useEffect, useMemo, useState } from "react";
import { Coffee, Utensils } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { buildRows } from "@/lib/timetable/buildGrid";
import { recentAcademicSessions, currentTimetableAcademicYear } from "@/lib/college/academicSession";
import type { CourseYearTiming, TimetableSlot, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

const days: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "09:00" -> "9:00 AM" - display only. */
function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

interface TimetableHistoryPanelProps {
  courseId: string;
  year: string;
  sectionId: string;
}

// Read-only - a PAST cohort's published timetable for this exact section
// (see Section.batch's own doc-comment: a Section is a fixed year-slot a new
// cohort occupies every academic session, so "Section A, 2nd Year" means a
// different set of students each year). Deliberately separate from the main
// grid page above rather than folded into its edit/publish/draft machinery -
// there is nothing to build here, only to look back at.
export function TimetableHistoryPanel({ courseId, year, sectionId }: TimetableHistoryPanelProps) {
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [isLoadingTiming, setIsLoadingTiming] = useState(true);
  // Every earlier session offered, newest first - excludes the current one,
  // since that's the live timetable one tab over, not history.
  const sessionOptions = useMemo(
    () => recentAcademicSessions().filter((s) => s !== currentTimetableAcademicYear()),
    []
  );
  const [academicYear, setAcademicYear] = useState(sessionOptions[0] ?? "");
  const [semester, setSemester] = useState<number | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  useEffect(() => {
    fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
      .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>)
      .then((d) => setTiming((d.timings ?? []).find((t) => t.year === Number(year)) ?? null))
      .catch(() => toast({ variant: "destructive", title: "Failed to load period timings" }))
      .finally(() => setIsLoadingTiming(false));
  }, [courseId, year]);

  // This course-year's configured semesters - same numbers apply to every
  // session (CourseYearTiming.semesters only carries the CURRENT session's
  // own date ranges, but the semester NUMBERS themselves, e.g. "1 and 2", are
  // what a past session's slots were tagged with too - see publish/route.ts).
  const semesterOptions = (timing?.semesters ?? []).map((s) => s.semester).sort((a, b) => a - b);

  useEffect(() => {
    // Wrapped so the setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect).
    void (async () => {
      if (!academicYear) { setSlots([]); return; }
      setIsLoadingSlots(true);
      const semQs = semester != null ? `&semester=${semester}` : "";
      try {
        const r = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}&academicYear=${encodeURIComponent(academicYear)}${semQs}`);
        const d = await r.json() as { slots: TimetableSlot[] };
        setSlots(d.slots ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load that session's timetable" });
      } finally {
        setIsLoadingSlots(false);
      }
    })();
  }, [sectionId, academicYear, semester]);

  const rows = timing ? buildRows(timing) : [];

  // Plural - a split period (two+ subjects/faculty sharing one section+day+
  // period) means a cell can hold more than one.
  function slotsFor(day: DayOfWeek, period: number) {
    return slots.filter((s) => s.day === day && s.periodNumber === period);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:max-w-2xl">
          <div className="space-y-1.5">
            <Label>Academic Session</Label>
            <Select value={academicYear} onValueChange={setAcademicYear} disabled={sessionOptions.length === 0}>
              <SelectTrigger><SelectValue placeholder={sessionOptions.length ? "Select session" : "No earlier sessions yet"} /></SelectTrigger>
              <SelectContent>
                {sessionOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {semesterOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Semester</Label>
              <Select value={String(semester ?? semesterOptions[0])} onValueChange={(v) => setSemester(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoadingTiming || isLoadingSlots ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !academicYear ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No earlier academic session to look back on yet.
        </div>
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Timings haven&rsquo;t been configured for this course-year.
        </div>
      ) : slots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing was published for {academicYear}{semester != null ? ` Semester ${semester}` : ""}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-24">Period</th>
                {days.map((d) => (
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
                      <td colSpan={days.length + 1} className="p-2 text-center text-xs font-medium text-amber-700">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5" />
                          {label} · {row.durationMinutes} min
                        </span>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={`period_${row.period}`} className="border-b last:border-b-0">
                    <td className="p-2.5 font-medium text-muted-foreground">
                      {row.period}
                      {row.startTime && row.endTime && (
                        <p className="text-[10px] font-normal whitespace-nowrap">
                          {formatTime12h(row.startTime)}&ndash;{formatTime12h(row.endTime)}
                        </p>
                      )}
                    </td>
                    {days.map((d) => {
                      const cellSlots = slotsFor(d, row.period);
                      return (
                        <td key={d} className="p-2 align-top">
                          {cellSlots.length > 0 ? (
                            <div className="space-y-1">
                              {cellSlots.map((slot) => (
                                <div key={slot.assignmentId} className="w-full rounded-md border bg-muted/40 p-2">
                                  <p className="text-xs font-semibold leading-tight">{slot.subjectName}</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">{slot.facultyName}</p>
                                  {slot.classroom && <p className="text-[11px] text-muted-foreground">{slot.classroom}</p>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="w-full rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">-</div>
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
