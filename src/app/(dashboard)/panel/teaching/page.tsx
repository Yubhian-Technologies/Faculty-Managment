"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { formatDMY, currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { buildFacultyTimetablePdfHtml } from "@/lib/timetable/facultyTimetablePdf";
import { downloadFacultyTimetableXlsx } from "@/lib/timetable/timetableExport";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import { TimetableSheetPreview } from "@/components/timetable/TimetableSheetPreview";
import type { TeachingAssignment, TimetableSlot, DayOfWeek, CourseYearTiming, PeriodTiming, Course, Department } from "@/types";

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

export default function TeachingLoadPage() {
  const { user } = useAuth();
  // Settings > Website Display Name > "Individual faculty timetable": the downloads print the Display Name.
  const { nameFor } = useFacultyDisplayNames();
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  // The longest day anywhere in the college, so every faculty member's grid runs from the college's first period to its last.
  const [collegePeriodCount, setCollegePeriodCount] = useState(0);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  // Monday of the week currently on screen - navigable via WeekNavigator,
  // defaulting to this calendar week. weekDates pairs positionally with
  // DAYS above, labelling each column with its actual date.
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);
  const weekDates = useMemo(() => currentWeekDates(weekStart), [weekStart]);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const [assignRes, coursesRes, deptsRes] = await Promise.all([
          fetch(`/api/college/teaching-assignments?week=${isoDateKey(weekStart)}`),
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
        // Timings are asked for BY course id: only then does the API add the
        // shared first year's timing to a managed-branch section (BSC-*, BSM-*
        // ...), which has no timing row of its own. A faculty's own slots span
        // several course-years, so periodTimeFor resolves each cell separately.
        // Merged by id across loads.
        const courseIds = Array.from(new Set([
          ...(json.assignments ?? []).map((a) => a.courseId),
          ...(json.timetableSlots ?? []).map((sl) => sl.courseId),
        ].filter(Boolean))).slice(0, 30);
        const timingsRes = await fetch(`/api/college/course-year-timings${courseIds.length ? `?courseId=${courseIds.join(",")}` : ""}`);
        if (timingsRes.ok) {
          const timingsJson = await timingsRes.json() as { timings: CourseYearTiming[] };
          setTimings((prev) => {
            const byKey = new Map(prev.map((t) => [`${t.courseId}_${t.year}`, t]));
            for (const t of timingsJson.timings ?? []) byKey.set(`${t.courseId}_${t.year}`, t);
            return Array.from(byKey.values());
          });
        }
        // The college-wide period count (first to last period of the college day), whatever this faculty teaches.
        try {
          const allTimingsRes = await fetch("/api/college/course-year-timings");
          if (allTimingsRes.ok) {
            const allJson = await allTimingsRes.json() as { timings?: CourseYearTiming[] };
            setCollegePeriodCount((allJson.timings ?? []).reduce((max, t) => Math.max(max, t.periods?.length || t.numberOfPeriods || 0), 0));
          }
        } catch { /* the faculty's own timings still set the grid */ }
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
  }, [weekStart]);

  const nonTeachingAssignmentIds = new Set(
    assignments
      .filter((a) => a.isNonTeachingLoad || a.excludeFromResume || (a as any).subjectType === "NON_TEACHING")
      .map((a) => a.id)
  );
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const filteredSlots = timetableSlots.filter(
    (s) => !nonTeachingAssignmentIds.has(s.assignmentId) && s.subjectType !== "NON_TEACHING" && !(s as any).isNonTeachingLoad
  );
  // Every period of the college day, not just the ones with a class in them: the longest day among the
  // loaded course-year timings, or a placed slot beyond it.
  const timingPeriodCount = timings.reduce((max, t) => Math.max(max, t.periods?.length || t.numberOfPeriods || 0), 0);
  const maxPeriod = filteredSlots.reduce((max, s) => Math.max(max, s.periodNumber), Math.max(timingPeriodCount, collegePeriodCount));
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

  // Periods a lunch/short break follows, for a slot's own course-year - a merged
  // cell is cut there.
  function breakAfterFor(slot: TimetableSlot) {
    const t = timings.find((x) => x.courseId === slot.courseId && x.year === slot.year);
    const set = new Set<number>();
    if (t?.lunchBreak?.afterPeriod != null) set.add(t.lunchBreak.afterPeriod);
    for (const b of t?.shortBreaks ?? []) set.add(b.afterPeriod);
    return set;
  }

  const { collegeInfo } = useCollegeInfo();
  const college = collegeInfo ?? undefined;
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);

  // The sheet as it downloads and prints: letterhead, grid, class list and signatures. Also what the page shows.
  function buildSheetHtml() {
    const semesterSlots = timetableSlots
      .filter((s) => !s.id.startsWith("substitute_"))
      .filter((s) => !nonTeachingAssignmentIds.has(s.assignmentId) && s.subjectType !== "NON_TEACHING" && !(s as { isNonTeachingLoad?: boolean }).isNonTeachingLoad)
      .filter((s) => typeFilter === "ALL" || s.subjectType === typeFilter);
    const semesterNums = Array.from(new Set(semesterSlots.map((sl) => sl.semester).filter((n): n is number => n != null))).sort((a, b) => a - b);
    return buildFacultyTimetablePdfHtml({
      facultyName: nameFor("individualTimetable", { uid: user?.uid }, user?.name ?? ""),
      departmentName: user?.department,
      semesterLabel: semesterNums.length > 0 ? semesterNums.join(", ") : "—",
      weekStart,
      weekEnd: weekDates[weekDates.length - 1],
      days: DAYS,
      periods,
      slots: semesterSlots,
      assignmentById,
      periodTimeFor,
      breakAfter: breakAfterFor,
      courseCodeById: new Map(courses.map((c) => [c.id, c.code || c.name])),
      departments,
      formatDMY,
      college,
    });
  }

  async function downloadPdf() {
    if (periods.length === 0) return;
    setIsExportingPdf(true);
    try {
      const html = buildSheetHtml();
      await renderHtmlToPdf(html, `Faculty-Teaching-Load-${isoDateKey(weekStart)}.pdf`);
      toast({ title: "Timetable downloaded", description: "Saved as PDF" });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Download failed", description: "Failed to generate PDF" });
    } finally {
      setIsExportingPdf(false);
    }
  }

  async function downloadXlsx() {
    if (periods.length === 0) return;
    setIsExportingXlsx(true);
    try {
      const semesterSlots = timetableSlots
        .filter((s) => !s.id.startsWith("substitute_"))
        .filter((s) => !nonTeachingAssignmentIds.has(s.assignmentId) && s.subjectType !== "NON_TEACHING" && !(s as any).isNonTeachingLoad)
        .filter((s) => typeFilter === "ALL" || s.subjectType === typeFilter);
      const semesterNums = Array.from(new Set(semesterSlots.map((s) => s.semester).filter((n): n is number => n != null))).sort((a, b) => a - b);
      const courseCodeById = new Map(courses.map((c) => [c.id, c.code || c.name]));
      await downloadFacultyTimetableXlsx(
        {
          facultyName: nameFor("individualTimetable", { uid: user?.uid }, user?.name ?? ""),
          semesterLabel: semesterNums.length > 0 ? semesterNums.join(", ") : "—",
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
          departmentName: user?.department,
          college,
        },
        `Semester-Timetable-${isoDateKey(weekStart)}.xlsx`
      );
      toast({ title: "Timetable exported", description: "Saved as Excel spreadsheet" });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Export failed", description: "Failed to export spreadsheet" });
    } finally {
      setIsExportingXlsx(false);
    }
  }

  function handlePrint() {
    if (periods.length === 0) return;
    const html = buildSheetHtml();
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ title: "Popup blocked", description: "Please allow popups to print", variant: "destructive" });
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Time Table"
          description="Assigned subjects and your weekly timetable, period by period"
        />
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Time Table"
        description="Assigned subjects and your weekly timetable, period by period"
      />

      {filteredSlots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No timetable slots are running for you right now.
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

            <Button size="sm" variant="outline" onClick={downloadPdf} disabled={isExportingPdf}>
              <FileDown className="h-3.5 w-3.5 mr-1.5" />
              {isExportingPdf ? "Generating PDF..." : "PDF"}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadXlsx} disabled={isExportingXlsx}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
              {isExportingXlsx ? "Exporting Excel..." : "Excel"}
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Print
            </Button>
          </div>
        </div>
        <TimetableSheetPreview html={buildSheetHtml()} title="My Time Table" />
        </>
      )}
    </div>
  );
}
