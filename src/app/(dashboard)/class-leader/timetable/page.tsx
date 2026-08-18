"use client";

import { useEffect, useState } from "react";
import { Coffee, Utensils } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import { buildRows } from "@/lib/timetable/buildGrid";
import type { Course, Section, CourseYearTiming, TimetableSlot, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/** "09:00" -> "9:00 AM" - display only. */
function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function ClassLeaderTimetablePage() {
  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/class-leader/timetable")
      .then((r) => r.json() as Promise<{ course?: Course; section?: Section; timing?: CourseYearTiming; slots?: TimetableSlot[]; error?: string }>)
      .then((d) => {
        setCourse(d.course ?? null);
        setSection(d.section ?? null);
        setTiming(d.timing ?? null);
        setSlots(d.slots ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load timetable" }))
      .finally(() => setIsLoading(false));
  }, []);

  const rows = timing ? buildRows(timing) : [];

  function slotFor(day: DayOfWeek, period: number) {
    return slots.find((s) => s.day === day && s.periodNumber === period);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={course && section ? `${course.name} · ${ordinalYear(section.year)} · Section ${section.name}` : "Timetable"}
        description="Your section's weekly timetable - updates automatically when faculty assignments change"
      />

      {isLoading ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !section ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No section is linked to your login yet. Ask College Office to link one.
        </div>
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Timings haven&rsquo;t been configured for {course?.name} - {ordinalYear(section.year)} yet.
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
                    <td className="p-2.5 font-medium text-muted-foreground">
                      {row.period}
                      {row.startTime && row.endTime && (
                        <p className="text-[10px] font-normal whitespace-nowrap">
                          {formatTime12h(row.startTime)}&ndash;{formatTime12h(row.endTime)}
                        </p>
                      )}
                    </td>
                    {DAYS.map((d) => {
                      const slot = slotFor(d, row.period);
                      return (
                        <td key={d} className="p-2 align-top">
                          {slot ? (
                            <div className={`rounded-md border p-2 ${slot.substituteFacultyName ? "bg-amber-50 border-amber-200" : "bg-primary/5 border-primary/20"}`}>
                              <p className="text-xs font-semibold leading-tight">{slot.subjectName}</p>
                              {slot.substituteFacultyName ? (
                                <>
                                  <p className="text-[11px] font-medium text-amber-700 mt-0.5">{slot.substituteFacultyName}</p>
                                  <p className="text-[10px] text-muted-foreground">Substituting for {slot.substituteForName}</p>
                                </>
                              ) : (
                                <p className="text-[11px] text-muted-foreground mt-0.5">{slot.facultyName}</p>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
