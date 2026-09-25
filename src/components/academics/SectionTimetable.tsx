"use client";

import { useEffect, useMemo, useState } from "react";
import { Coffee, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDMY, currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { buildRows } from "@/lib/timetable/buildGrid";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import type { Section, CourseYearTiming, TimetableSlot, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "09:00" -> "9:00 AM" */
function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Read-only PUBLISHED timetable of ONE section (`timetableSlots` never holds
// drafts), rendered in place inside the section view.
export function SectionTimetable({ section }: { section: Section }) {
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);
  const weekDates = useMemo(() => currentWeekDates(weekStart), [weekStart]);
  const [loadedFor, setLoadedFor] = useState("");
  const loadKey = `${section.id}_${isoDateKey(weekStart)}`;
  const isLoadingGrid = loadedFor !== loadKey;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [t, d] = await Promise.all([
          fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(section.courseId)}`)
            .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
          fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(section.id)}&week=${isoDateKey(weekStart)}`)
            .then((r) => r.json() as Promise<{ slots: TimetableSlot[] }>),
        ]);
        if (cancelled) return;
        setTiming((t.timings ?? []).find((x) => Number(x.year) === Number(section.year)) ?? null);
        setSlots(d.slots ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load timetable" });
      } finally {
        if (!cancelled) setLoadedFor(loadKey);
      }
    })();
    return () => { cancelled = true; };
  }, [section.id, section.courseId, section.year, weekStart, loadKey]);

  const rows = timing ? buildRows(timing) : [];
  const displaySlots = typeFilter === "ALL" ? slots : slots.filter((s) => s.subjectType === typeFilter);

  if (isLoadingGrid) return <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />;
  if (!timing) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Period timings haven&rsquo;t been configured for this course year yet.
      </div>
    );
  }
  if (slots.length === 0) {
    return (
      <div className="space-y-4">
        <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No timetable has been published for this section yet. The HOD builds and publishes it from their Timetable page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Show:</span>
        {(["ALL", "THEORY", "PRACTICAL"] as const).map((t) => (
          <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} onClick={() => setTypeFilter(t)}>
            {t === "ALL" ? "All" : t === "THEORY" ? "Theory" : "Practical"}
          </Button>
        ))}
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
          {rows.map((row, idx) => {
            if (row.kind === "lunch" || row.kind === "short") {
              const Icon = row.kind === "lunch" ? Utensils : Coffee;
              const label = row.kind === "lunch" ? "Lunch Break" : "Short Break";
              return (
                <tr key={`break_${idx}`} className="bg-amber-50/60">
                  <td colSpan={DAYS.length + 1} className="p-2 text-center text-xs font-medium text-amber-700">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />{label} · {row.durationMinutes} min
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
                  const slot = displaySlots.find((s) => s.day === d && s.periodNumber === row.period);
                  return (
                    <td key={d} className="p-2 align-top">
                      {slot ? (
                        <div className={`rounded-md border p-2 ${slot.substituteFacultyName ? "bg-amber-50 border-amber-200" : "bg-primary/5 border-primary/20"}`}>
                          <p className="text-xs font-semibold leading-tight">{slot.subjectName}</p>
                          {slot.substituteFacultyName ? (
                            <>
                              <p className="text-[11px] font-medium text-amber-700 mt-0.5">{slot.substituteFacultyName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                Substituting for {slot.substituteForName}{slot.substituteDate ? ` (${formatDMY(slot.substituteDate)})` : ""}
                              </p>
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
    </div>
  );
}
