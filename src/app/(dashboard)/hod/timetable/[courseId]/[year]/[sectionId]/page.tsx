"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Coffee, Utensils } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { Course, Section, CourseYearTiming, TimetableSlot, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

type Row =
  | { kind: "period"; period: number }
  | { kind: "lunch"; durationMinutes: number }
  | { kind: "short"; durationMinutes: number };

function buildRows(timing: CourseYearTiming): Row[] {
  const rows: Row[] = [];
  for (let p = 1; p <= timing.numberOfPeriods; p++) {
    rows.push({ kind: "period", period: p });
    if (timing.lunchBreak?.afterPeriod === p) {
      rows.push({ kind: "lunch", durationMinutes: timing.lunchBreak.durationMinutes });
    }
    for (const sb of timing.shortBreaks ?? []) {
      if (sb.afterPeriod === p) rows.push({ kind: "short", durationMinutes: sb.durationMinutes });
    }
  }
  return rows;
}

export default function HODTimetableGridPage() {
  const router = useRouter();
  const { courseId, year, sectionId } = useParams<{ courseId: string; year: string; sectionId: string }>();

  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
        .then((r) => r.json() as Promise<{ sections: Section[] }>),
      fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
        .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
      fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}`)
        .then((r) => r.json() as Promise<{ slots: TimetableSlot[] }>),
    ])
      .then(([coursesData, sectionsData, timingsData, slotsData]) => {
        setCourse((coursesData.courses ?? []).find((c) => c.id === courseId) ?? null);
        setSection((sectionsData.sections ?? []).find((s) => s.id === sectionId) ?? null);
        setTiming((timingsData.timings ?? []).find((t) => t.year === Number(year)) ?? null);
        setSlots(slotsData.slots ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load timetable" }))
      .finally(() => setIsLoading(false));
  }, [courseId, year, sectionId]);

  const rows = timing ? buildRows(timing) : [];

  function slotFor(day: DayOfWeek, period: number) {
    return slots.find((s) => s.day === day && s.periodNumber === period);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={course && section ? `${course.name} · ${ordinalYear(Number(year))} · Section ${section.name}` : "Timetable"}
        description="Auto-generated from faculty teaching assignments"
        actions={
          <Button variant="outline" onClick={() => router.push(`/hod/timetable/${courseId}/${year}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Sections
          </Button>
        }
      />

      {isLoading ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Timings haven&rsquo;t been configured for {course?.name} — {ordinalYear(Number(year))} yet. Ask the Principal to set them up under Departments first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-24">Period</th>
                {DAYS.map((d) => (
                  <th key={d} className="p-2.5 text-left font-medium text-muted-foreground border-b min-w-[140px]">
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
                          <Icon className="h-3.5 w-3.5" />
                          {label} · {row.durationMinutes} min
                        </span>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={`period_${row.period}`} className="border-b last:border-b-0">
                    <td className="p-2.5 font-medium text-muted-foreground">{row.period}</td>
                    {DAYS.map((d) => {
                      const slot = slotFor(d, row.period);
                      return (
                        <td key={d} className="p-2 align-top">
                          {slot ? (
                            <div className="rounded-md border bg-primary/5 border-primary/20 p-2">
                              <p className="text-xs font-semibold leading-tight">{slot.subjectName}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{slot.facultyName}</p>
                              {slot.classroom && <p className="text-[11px] text-muted-foreground">{slot.classroom}</p>}
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">—</div>
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
