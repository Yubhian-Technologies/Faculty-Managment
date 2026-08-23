"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";

interface WeekNavigatorProps {
  /** Monday of the currently displayed week. */
  weekStart: Date;
  onChange: (weekStart: Date) => void;
}

// Prev/next-week arrows plus a calendar picker, shared by every read-only
// timetable grid (Principal, HOD/Faculty Teaching Load, Class Leader) and
// the Timetable Incharge editor's Published view - so a substitution dated
// for a week other than the one on screen can actually be found instead of
// only ever showing (or not showing) under whatever "today" happens to be.
export function WeekNavigator({ weekStart, onChange }: WeekNavigatorProps) {
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 5);

  function shiftWeek(days: number) {
    onChange(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + days));
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const [y, m, d] = e.target.value.split("-").map(Number);
    if (!y || !m || !d) return;
    // Snap whatever date was picked to that date's own Monday - a picked
    // Wednesday, say, still means "show me that whole week."
    onChange(currentWeekDates(new Date(y, m - 1, d))[0]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftWeek(-7)} aria-label="Previous week">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span>
        This week: {formatDate(weekStart)} &ndash; {formatDate(weekEnd)}
      </span>
      <label className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground cursor-pointer">
        <Calendar className="h-4 w-4 pointer-events-none" />
        <input
          type="date"
          value={isoDateKey(weekStart)}
          onChange={handlePick}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Pick a week"
        />
      </label>
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftWeek(7)} aria-label="Next week">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
