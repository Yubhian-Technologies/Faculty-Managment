"use client";

import { useEffect, useState } from "react";
import { toast } from "@/hooks/useToast";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import type { Section, CourseYearTiming, TimetableSlot, Subject, DayOfWeek } from "@/types";

// Read-only PUBLISHED timetable of ONE section (`timetableSlots` never holds
// drafts), rendered in place inside the section view with institutional Vishnu layout.
export function SectionTimetable({ section }: { section: Section }) {
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);
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
            .then((r) => r.json() as Promise<{ slots: TimetableSlot[]; subjects?: Subject[]; workingDays?: DayOfWeek[] }>),
        ]);
        if (cancelled) return;
        setTiming((t.timings ?? []).find((x) => Number(x.year) === Number(section.year)) ?? null);
        setSlots(d.slots ?? []);
        setSubjects(d.subjects ?? []);
        setWorkingDays(d.workingDays ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load timetable" });
      } finally {
        if (!cancelled) setLoadedFor(loadKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section.id, section.courseId, section.year, weekStart, loadKey]);

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
    <InstitutionalTimetableTable
      section={section}
      timing={timing}
      slots={slots}
      courseName={section.courseName}
      departmentName={section.department}
      academicYear={slots[0]?.academicYear}
      workingDays={workingDays}
      weekStart={weekStart}
      onWeekChange={setWeekStart}
      showWeekNav={true}
      typeFilter={typeFilter}
      onTypeFilterChange={setTypeFilter}
      subjects={subjects}
    />
  );
}
