"use client";

import { useEffect, useState } from "react";
import { CalendarOff } from "lucide-react";

interface TodayAnswer {
  holiday: boolean;
  reason?: string;
  hostelersOutingAllowed?: boolean;
}

// "Today is a holiday" notice shown above the timetable (rendered by the
// dashboard shell on every timetable page). The timetable grid is the weekly
// pattern and keeps showing it; this just says today's periods won't run.
export function TodayHolidayBanner() {
  const [today, setToday] = useState<TodayAnswer | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/college/holidays/today")
      .then((r) => (r.ok ? (r.json() as Promise<TodayAnswer>) : null))
      .then((d) => { if (!cancelled && d?.holiday) setToday(d); })
      .catch(() => {
        // Non-fatal - a missing banner isn't worth an error toast.
      });
    return () => { cancelled = true; };
  }, []);

  if (!today) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
      <CalendarOff className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium text-foreground">Today is a holiday &mdash; no classes are held.</p>
        <p className="text-muted-foreground">
          {today.reason}
          {today.hostelersOutingAllowed != null &&
            ` · Hostellers ${today.hostelersOutingAllowed ? "are permitted" : "are not permitted"} to go out.`}
        </p>
      </div>
    </div>
  );
}
