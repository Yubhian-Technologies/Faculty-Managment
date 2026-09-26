"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Layers, FileDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDMY, currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import type { TeachingAssignment, TimetableSlot, DayOfWeek, CourseYearTiming, PeriodTiming } from "@/types";
import { DAY_LABELS } from "@/types";

// Grid instead of a per-subject card list: an HOD who also personally
// teaches thinks in terms of "what am I teaching on Monday period 3", not a
// flat list of subjects, so this lays their own slots out the same way the
// HOD/Principal Timetable pages do (Day columns x Period rows). Unlike those
// pages, this never picks a single CourseYearTiming for the whole grid -
// their own slots can span several course-years with different period
// configs - so each occupied cell resolves its own clock time from ITS
// slot's courseId+year instead of one shared row-level time. Mirrors
// panel/teaching/page.tsx.

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

// A subject/section/classroom name containing "&", "<" or similar HTML-significant
// characters would otherwise render as broken markup in the downloaded PDF.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function HODTeachingPage() {
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [semester, setSemester] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Monday of the week currently on screen - navigable via WeekNavigator,
  // defaulting to this calendar week. weekDates pairs positionally with
  // DAYS above, labelling each column with its actual date.
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);
  const weekDates = useMemo(() => currentWeekDates(weekStart), [weekStart]);
  const semesterOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const t of timings) for (const s of t.semesters ?? []) nums.add(s.semester);
    return Array.from(nums).sort((a, b) => a - b);
  }, [timings]);
  const effectiveSemester = semesterOptions.length === 0
    ? null
    : semester != null && semesterOptions.includes(semester) ? semester : semesterOptions[0];

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const qs = `myAssignments=true&week=${isoDateKey(weekStart)}${effectiveSemester != null ? "&semester=" + effectiveSemester : ""}`;
        const [assignRes, timingsRes] = await Promise.all([
          fetch(`/api/college/teaching-assignments?${qs}`),
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
  }, [weekStart, effectiveSemester]);

  const totalHoursPerWeek = assignments.reduce((sum, a) => sum + (a.hoursPerWeek ?? 0), 0);
  const subjectCount = assignments.length;
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const maxPeriod = timetableSlots.reduce((max, s) => Math.max(max, s.periodNumber), 0);
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);
  const displaySlots = typeFilter === "ALL" ? timetableSlots : timetableSlots.filter((s) => s.subjectType === typeFilter);

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

  function downloadPdf() {
    if (periods.length === 0) return;
    // A real "–" character, not the &ndash; HTML entity - the entity would
    // otherwise get HTML-escaped a second time below (escapeHtml turns its "&"
    // into "&amp;"), printing the literal text "&ndash;" in the PDF instead of
    // a dash.
    const EN_DASH = "–";
    // The download is the standing SEMESTER timetable (the recurring MON-SAT
    // pattern this person teaches every week), not a snapshot of whichever
    // calendar week happens to be on screen - so it deliberately drops two
    // things the on-screen grid overlays for the browsed week only: (1) the
    // synthetic "substitute_*" entries api/college/teaching-assignments
    // injects for a period this person is one-off covering for someone else
    // (never a recurring slot of theirs), and (2) the substituteFacultyName/
    // substituteForName annotation a leave-covered slot of their OWN picks up
    // for that specific week - both would misrepresent every other week's
    // actual schedule.
    const semesterSlots = timetableSlots
      .filter((s) => !s.id.startsWith("substitute_"))
      .filter((s) => typeFilter === "ALL" || s.subjectType === typeFilter);
    const dayHeaderCells = DAYS.map((d) =>
      `<th style="border:1px solid #1e2a5e;background:#0a0a7a;color:#fff;padding:6px 4px;font-size:10.5px;">${escapeHtml(DAY_LABELS[d])}</th>`
    ).join("");
    const bodyRows = periods.map((period) => {
      const cells = DAYS.map((d) => {
        const slot = semesterSlots.find((s) => s.day === d && s.periodNumber === period);
        if (!slot) {
          return `<td style="border:1px solid #e5e7eb;padding:3px;vertical-align:middle;"><div style="border:1px dashed #d1d5db;border-radius:4px;padding:12px 2px;text-align:center;color:#c4c4c4;font-size:11px;">${EN_DASH}</div></td>`;
        }
        const assignment = assignmentById.get(slot.assignmentId);
        const time = periodTimeFor(slot.courseId, slot.year, slot.periodNumber);
        const subline = [
          assignment?.courseName,
          assignment?.year ? ordinalYear(assignment.year) : null,
          assignment?.sectionName ? `Section ${assignment.sectionName}` : null,
        ].filter(Boolean).join(" · ");
        const timeLine = time
          ? `<div style="font-size:8.5px;color:#6b7280;margin-bottom:2px;">${escapeHtml(formatTime12h(time.startTime))}${EN_DASH}${escapeHtml(formatTime12h(time.endTime))}</div>`
          : "";
        const subjectLine = `<div style="font-size:10.5px;font-weight:700;color:#111827;line-height:1.25;">${escapeHtml(slot.subjectName)}</div>`;
        const noteLine = subline
          ? `<div style="font-size:9px;color:#6b7280;margin-top:2px;line-height:1.25;">${escapeHtml(subline)}</div>`
          : "";
        const roomLine = slot.classroom
          ? `<div style="font-size:8.5px;color:#6b7280;margin-top:1px;">${escapeHtml(slot.classroom)}</div>`
          : "";
        return `<td style="border:1px solid #e5e7eb;padding:3px;vertical-align:top;"><div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:5px;padding:5px 6px;">${timeLine}${subjectLine}${noteLine}${roomLine}</div></td>`;
      }).join("");
      return `<tr><td style="border:1px solid #e5e7eb;padding:4px;font-size:11px;font-weight:700;text-align:center;background:#f3f4f6;vertical-align:middle;">${period}</td>${cells}</tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,Helvetica,sans-serif;margin:18px;color:#111827;}
      table{border-collapse:collapse;width:100%;table-layout:fixed;}
      col.period{width:9%;}
    </style></head><body>
      <h3 style="margin:0;text-align:center;font-size:18px;">Semester Timetable</h3>
      <p style="margin:2px 0 14px;text-align:center;font-size:10.5px;color:#6b7280;">Standing weekly schedule for this semester</p>
      <table>
        <colgroup><col class="period" />${DAYS.map(() => "<col />").join("")}</colgroup>
        <thead><tr><th style="border:1px solid #1e2a5e;background:#0a0a7a;color:#fff;padding:6px 4px;font-size:10.5px;">Period</th>${dayHeaderCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </body></html>`;
    void renderHtmlToPdf(html, `Semester-Timetable-${isoDateKey(weekStart)}.pdf`);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Teaching Load"
          description="Your subject allocations and weekly timetable, period by period"
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
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
        description="Your subject allocations and weekly timetable, period by period"
      />

      {/* Summary cards */}
      {assignments.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-8 w-8 text-blue-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Total Weekly Hours</p>
                <p className="text-3xl font-bold text-blue-600">{totalHoursPerWeek}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Layers className="h-8 w-8 text-indigo-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Subjects Assigned</p>
                <p className="text-3xl font-bold text-indigo-600">{subjectCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {periods.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No timetable slots have been published for you yet.
        </div>
      ) : (
<>
         <div className="flex flex-wrap items-center justify-between gap-2">
           <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
           <div className="flex items-center gap-2">
             <span className="text-xs font-medium text-muted-foreground">Show:</span>
             {(["ALL", "THEORY", "PRACTICAL"] as const).map((t) => (
               <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} onClick={() => setTypeFilter(t)}>
                 {t === "ALL" ? "All" : t === "THEORY" ? "Theory" : "Practical"}
               </Button>
             ))}
             {semesterOptions.length > 0 && (
               <select
                 className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none"
                 value={effectiveSemester != null ? String(effectiveSemester) : ""}
                 onChange={(e) => setSemester(Number(e.target.value))}
               >
                 <option value="">All semesters</option>
                 {semesterOptions.map((s) => (
                   <option key={s} value={s}>Semester {s}</option>
                 ))}
               </select>
             )}
             <Button size="sm" variant="outline" onClick={downloadPdf}>
               <FileDown className="h-3.5 w-3.5 mr-1.5" />Download
             </Button>
           </div>
         </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-24">Period</th>
                {DAYS.map((d, i) => (
                  <th key={d} className="p-2.5 text-left font-medium text-muted-foreground border-b min-w-35">
                    <p className="text-[10px] font-normal whitespace-nowrap">{formatDMY(weekDates[i])}</p>
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
                    const slot = displaySlots.find((s) => s.day === d && s.periodNumber === period);
                    const assignment = slot ? assignmentById.get(slot.assignmentId) : undefined;
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
                              <p className="text-[11px] font-medium text-amber-700 mt-0.5">
                                Covered by {slot.substituteFacultyName}{slot.substituteDate ? ` (${formatDMY(slot.substituteDate)})` : ""}
                              </p>
                            ) : slot.substituteForName ? (
                              <p className="text-[11px] font-medium text-amber-700 mt-0.5">
                                Substituting for {slot.substituteForName}{slot.substituteDate ? ` (${formatDMY(slot.substituteDate)})` : ""}
                              </p>
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
        </>
      )}
    </div>
  );
}
