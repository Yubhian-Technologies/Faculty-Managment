"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { formatDMY, currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { buildFacultyTimetablePdfHtml, formatTime12h as format12h } from "@/lib/timetable/facultyTimetablePdf";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import type { TeachingAssignment, TimetableSlot, DayOfWeek, CourseYearTiming, PeriodTiming, Course, Department } from "@/types";
import { DAY_LABELS } from "@/types";
import { yearSemesterLabel } from "@/lib/academic/format";

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

function toRomanYear(y: number): string {
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
  return ROMAN[y] ?? String(y);
}

function shortCourseName(c?: string): string {
  if (!c) return "";
  const name = c.trim();
  if (/^(bachelor of technology|b\.?\s?tech)\b/i.test(name)) return "B.Tech";
  if (/^(master of technology|m\.?\s?tech)\b/i.test(name)) return "M.Tech";
  if (/^(bachelor of engineering|b\.?\s?e)\.?$/i.test(name)) return "B.E";
  if (/^(master of business administration|mba)$/i.test(name)) return "MBA";
  if (/^(master of computer applications|mca)$/i.test(name)) return "MCA";
  return name;
}

function formatTeachingShorthand(parts: {
  courseName?: string;
  year?: number;
  semester?: number | string;
  sectionName?: string;
}): string {
  const yearStr = parts.year != null ? toRomanYear(parts.year) : "";
  const courseStr = shortCourseName(parts.courseName);
  const semNum = typeof parts.semester === "number" ? parts.semester : (parts.semester ? Number(parts.semester.toString().match(/\d+/g)?.pop()) || parts.semester : undefined);
  const semStr = semNum != null ? (typeof semNum === "number" ? `${toRomanYear(Number(semNum))} Sem` : `${semNum} Sem`) : "";

  // Strip BS/BSE/BSC prefix tags (e.g. "BSE-ME-A" -> "ME-A", "BSC-CSE-C" -> "CSE-C")
  let sec = (parts.sectionName ?? "").trim().replace(/^BS[EC]?[-_]/i, "");
  if (sec) sec = `Section ${sec}`;

  const classPrefix = [yearStr, courseStr, semStr].filter(Boolean).join(" ");
  return [classPrefix, sec].filter(Boolean).join(" - ");
}

export default function HODTeachingPage() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
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
        const [assignRes, timingsRes, coursesRes, deptsRes] = await Promise.all([
          fetch(`/api/college/teaching-assignments?${qs}`),
          fetch("/api/college/course-year-timings"),
          fetch("/api/college/courses"),
          fetch("/api/college/departments"),
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
        // Course short codes and department codes - needed only for the
        // downloaded PDF's short "B.TECH II ECE-A" style sub-line, never the
        // on-screen grid (which still shows the full course name/ordinal
        // year, unchanged).
        if (coursesRes.ok) {
          const coursesJson = await coursesRes.json() as { courses?: Course[] };
          setCourses(coursesJson.courses ?? []);
        }
        if (deptsRes.ok) {
          const deptsJson = await deptsRes.json() as { departments?: Department[] };
          setDepartments(deptsJson.departments ?? []);
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load teaching load" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [weekStart, effectiveSemester]);

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
    const courseCodeById = new Map(courses.map((c) => [c.id, c.code || c.name]));
    const html = buildFacultyTimetablePdfHtml({
      facultyName: user?.name ?? "",
      semesterLabel: effectiveSemester != null ? String(effectiveSemester) : "—",
      weekStart,
      weekEnd: weekDates[weekDates.length - 1],
      days: DAYS,
      periods,
      slots: semesterSlots,
      assignmentById,
      periodTimeFor,
      courseCodeById,
      departments,
      formatDMY,
    });
    void renderHtmlToPdf(html, `Semester-Timetable-${isoDateKey(weekStart)}.pdf`);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Teaching Load"
          description="Your subject allocations and weekly timetable, period by period"
        />
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
                   <option key={s} value={s}>{yearSemesterLabel(s)}</option>
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
                    // Every slot in the cell, not the first: one faculty can hold
                    // two sections in the same period (e.g. a combined class).
                    const cellSlots = displaySlots.filter((s) => s.day === d && s.periodNumber === period);
                    return (
                      <td key={d} className="p-2 align-top">
                        {cellSlots.length > 0 ? (
                          <div className="space-y-1.5">
                            {cellSlots.map((slot, idx) => {
                              const assignment = assignmentById.get(slot.assignmentId);
                              const time = periodTimeFor(slot.courseId, slot.year, slot.periodNumber);
                              const courseByIdMap = new Map(courses.map((c) => [c.id, c]));
                              const resolvedCourseName = assignment?.courseName || courseByIdMap.get(slot.courseId || "")?.name;
                              const subline = formatTeachingShorthand({
                                courseName: resolvedCourseName,
                                year: assignment?.year ?? slot.year,
                                semester: assignment?.timetableSemester ?? assignment?.semester,
                                sectionName: assignment?.sectionName,
                              });
                              const subjectName = slot.subjectName || assignment?.subjectName || "";
                              const shortCode = assignment?.shortCode;
                              const titleDisplay = shortCode ? `${subjectName} (${shortCode})` : subjectName;

                              return (
                                <div key={`${slot.id ?? idx}`} className={`rounded-md border p-2 ${slot.substituteFacultyName || slot.substituteForName ? "bg-amber-50 border-amber-200" : "bg-primary/5 border-primary/20"}`}>
                                  {time && (
                                    <p className="text-[10px] font-medium text-muted-foreground/80 mb-0.5">
                                      {format12h(time.startTime)}&ndash;{format12h(time.endTime)}
                                    </p>
                                  )}
                                  <p className="text-xs font-semibold leading-tight">{titleDisplay}</p>
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
                                  {slot.classroom && (
                                    <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
                                      {/^room/i.test(slot.classroom.trim()) ? slot.classroom.trim() : `Room: ${slot.classroom.trim()}`}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
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
