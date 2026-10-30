"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { displayNameFor, readDisplayNameSettings } from "@/lib/faculty/displayNameSettings";
import { currentWeekDates, formatDMY } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { buildFacultyTimetablePdfHtml } from "@/lib/timetable/facultyTimetablePdf";
import type { Course, CourseYearTiming, DayOfWeek, Department, FacultyMember, PeriodTiming, TeachingAssignment, TimetableSlot } from "@/types";

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

type FacultyRow = Record<string, unknown> & FacultyMember;

// "Individual timetable" (HOD): the department's faculty as a list; clicking a name builds that
// person's own timetable sheet - the same PDF the faculty member downloads from their Teaching
// Load page - for the current week and downloads it at once.
export function IndividualTimetablePanel({ scopeLabel = "in your department" }: { scopeLabel?: string } = {}) {
  const { collegeInfo } = useCollegeInfo();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/faculty");
        const d = await res.json() as { faculty?: FacultyRow[]; error?: string };
        if (!res.ok) throw new Error(d.error ?? "Failed to load faculty");
        setFaculty(d.faculty ?? []);
      } catch (err) {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load faculty" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faculty
      .filter((f) => f.status !== "RESIGNED" && f.status !== "RETIRED")
      .filter((f) => !q || `${facultyDisplayName(f)} ${f.employeeId ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => facultyDisplayName(a).localeCompare(facultyDisplayName(b)));
  }, [faculty, query]);

  async function download(f: FacultyRow) {
    const id = f.id as string;
    setBusyId(id);
    try {
      const weekStart = currentWeekDates()[0];
      const weekDates = currentWeekDates(weekStart);
      const [assignRes, coursesRes, deptsRes, allTimingsRes] = await Promise.all([
        fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(id)}&week=${isoDateKey(weekStart)}`),
        fetch("/api/college/courses"),
        fetch("/api/college/departments"),
        fetch("/api/college/course-year-timings"),
      ]);
      if (!assignRes.ok) throw new Error("Failed to load this faculty's timetable");
      const json = await assignRes.json() as { assignments?: TeachingAssignment[]; timetableSlots?: TimetableSlot[] };
      const assignments = json.assignments ?? [];
      const slots = json.timetableSlots ?? [];
      const courses = coursesRes.ok ? ((await coursesRes.json()) as { courses?: Course[] }).courses ?? [] : [];
      const departments = deptsRes.ok ? ((await deptsRes.json()) as { departments?: Department[] }).departments ?? [] : [];
      const allTimings = allTimingsRes.ok ? ((await allTimingsRes.json()) as { timings?: CourseYearTiming[] }).timings ?? [] : [];

      // Timings are asked for by course id so a shared first year's timing reaches managed-branch sections.
      const courseIds = Array.from(new Set([...assignments.map((a) => a.courseId), ...slots.map((s) => s.courseId)].filter(Boolean))).slice(0, 30);
      const timingsById = new Map(allTimings.map((t) => [`${t.courseId}_${t.year}`, t]));
      if (courseIds.length) {
        const tr = await fetch(`/api/college/course-year-timings?courseId=${courseIds.join(",")}`);
        if (tr.ok) for (const t of ((await tr.json()) as { timings?: CourseYearTiming[] }).timings ?? []) timingsById.set(`${t.courseId}_${t.year}`, t);
      }
      const timings = Array.from(timingsById.values());

      const nonTeaching = new Set(
        assignments
          .filter((a) => a.isNonTeachingLoad || a.excludeFromResume || (a as { subjectType?: string }).subjectType === "NON_TEACHING")
          .map((a) => a.id),
      );
      const shown = slots
        .filter((s) => !s.id.startsWith("substitute_"))
        .filter((s) => !nonTeaching.has(s.assignmentId) && s.subjectType !== "NON_TEACHING" && !(s as { isNonTeachingLoad?: boolean }).isNonTeachingLoad);
      if (shown.length === 0) {
        toast({ title: "No timetable yet", description: `${facultyDisplayName(f)} has no periods placed this week.` });
        return;
      }

      const collegePeriods = allTimings.reduce((m, t) => Math.max(m, t.periods?.length || t.numberOfPeriods || 0), 0);
      const timingPeriods = timings.reduce((m, t) => Math.max(m, t.periods?.length || t.numberOfPeriods || 0), 0);
      const maxPeriod = shown.reduce((m, s) => Math.max(m, s.periodNumber), Math.max(timingPeriods, collegePeriods));
      const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

      const periodsByCourseYear = new Map<string, PeriodTiming[]>(
        timings.map((t) => [`${t.courseId}_${t.year}`, t.periods && t.periods.length > 0 ? t.periods : defaultPeriodTimings(t)]),
      );
      const breakAfter = (slot: TimetableSlot) => {
        const t = timings.find((x) => x.courseId === slot.courseId && x.year === slot.year);
        const set = new Set<number>();
        if (t?.lunchBreak?.afterPeriod != null) set.add(t.lunchBreak.afterPeriod);
        for (const b of t?.shortBreaks ?? []) set.add(b.afterPeriod);
        return set;
      };
      const semesterNums = Array.from(new Set(shown.map((s) => s.semester).filter((n): n is number => n != null))).sort((a, b) => a - b);

      const html = buildFacultyTimetablePdfHtml({
        // Settings > Website Display Name: shows the Display Name when the college ticked "Individual faculty timetable".
        facultyName: displayNameFor(f, readDisplayNameSettings({ surfaces: collegeInfo?.displayNameSurfaces }), "individualTimetable", facultyDisplayName(f)),
        departmentName: f.department as string | undefined,
        semesterLabel: semesterNums.length > 0 ? semesterNums.join(", ") : "—",
        weekStart,
        weekEnd: weekDates[weekDates.length - 1],
        days: DAYS,
        periods,
        slots: shown,
        assignmentById: new Map(assignments.map((a) => [a.id, a])),
        periodTimeFor: (courseId, year, period) => (courseId && year ? periodsByCourseYear.get(`${courseId}_${year}`)?.find((p) => p.period === period) : undefined),
        breakAfter,
        courseCodeById: new Map(courses.map((c) => [c.id, c.code || c.name])),
        departments,
        formatDMY,
        college: collegeInfo ?? undefined,
      });
      const safeName = facultyDisplayName(f).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Faculty";
      await renderHtmlToPdf(html, `Timetable-${safeName}.pdf`, { fitOnePage: true });
      toast({ title: "Timetable downloaded", description: `${facultyDisplayName(f)} - saved as PDF` });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Download failed", description: err instanceof Error ? err.message : "Failed to generate PDF" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">Individual timetable</h2>
          <p className="text-sm text-muted-foreground">Faculty {scopeLabel}. Click a name to download that faculty member&apos;s timetable as a PDF.</p>
        </div>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name or employee ID" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading faculty…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No faculty found.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((f) => {
              const busy = busyId === (f.id as string);
              return (
                <li key={f.id as string}>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void download(f)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{facultyDisplayName(f)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{[f.employeeId, f.designation].filter(Boolean).join(" · ")}</span>
                    </span>
                    {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <FileDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
