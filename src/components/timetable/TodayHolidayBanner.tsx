"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarOff } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

export interface TodayHoliday {
  holiday: boolean;
  /** Staff only: a students-only holiday / class suspension - a working day, but no classes are held. */
  classesOff?: boolean;
  reason?: string;
  hostelersOutingAllowed?: boolean;
}

/** Is today a holiday for the signed-in person (the class calendar for students, staff holidays for staff)?
 *  One cached request shared by the notice and the dashboards; null while unknown or when it can't be told. */
export function useTodayHoliday(): TodayHoliday | null {
  const user = useAuthStore((s) => s.user);
  const { data } = useQuery({
    queryKey: ["holiday-today", user?.collegeId, user?.uid],
    queryFn: () => fetch("/api/college/holidays/today").then((r) => (r.ok ? (r.json() as Promise<TodayHoliday>) : null)).catch(() => null),
    enabled: !!user?.collegeId,
    staleTime: 10 * 60_000,
  });
  return data ?? null;
}

// "Today is a holiday" notice, shown by the dashboard shell above every timetable page and every dashboard home.
// The timetable grid is the weekly pattern and keeps showing it; this just says today's periods won't run.
export function TodayHolidayBanner() {
  const today = useTodayHoliday();
  if (!today?.holiday && !today?.classesOff) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
      <CalendarOff className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
      <div>
        <p className="font-medium text-foreground">
          {today.holiday ? <>Today is a holiday &mdash; no classes are held.</> : <>No classes today &mdash; staff work as usual.</>}
        </p>
        <p className="text-muted-foreground">
          {today.reason}
          {today.hostelersOutingAllowed != null &&
            ` · Hostellers ${today.hostelersOutingAllowed ? "are permitted" : "are not permitted"} to go out.`}
        </p>
      </div>
    </div>
  );
}
