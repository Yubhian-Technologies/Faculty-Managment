"use client";

import { useEffect, useState } from "react";
import { toDate, formatDate } from "@/lib/utils";
import { todayISODate, isoDateKey } from "@/lib/leave/dayCounter";
import type { SummerHoliday } from "@/types";

// College Office's one from/to range per academic year (see the Holidays
// page's "Summer Holidays" section) - shown here the day before it starts
// and through to its last day, purely informational (never blocks applying
// for regular leave). Rendered once in the dashboard shell (see
// (dashboard)/layout.tsx) so it's visible everywhere, not just the Leave
// module - every role sees it the same way, no per-page wiring needed.
export function SummerHolidayBanner() {
  const [active, setActive] = useState<SummerHoliday | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/college/summer-holidays")
      .then((r) => r.json() as Promise<{ summerHolidays?: SummerHoliday[] }>)
      .then((d) => {
        if (cancelled) return;
        const today = todayISODate();
        const current = (d.summerHolidays ?? []).find((s) => {
          const from = toDate(s.fromDate);
          const to = toDate(s.toDate);
          if (!from || !to) return false;
          const visibleFrom = isoDateKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1));
          const toISO = isoDateKey(to);
          return today >= visibleFrom && today <= toISO;
        });
        setActive(current ?? null);
      })
      .catch(() => {
        // Non-fatal - a missing banner isn't worth surfacing an error toast for.
      });
    return () => { cancelled = true; };
  }, []);

  if (!active) return null;

  return (
    <div className="w-full border-b bg-muted/50 px-4 md:px-6 py-2 text-center text-sm text-foreground">
      Summer Holidays: {formatDate(active.fromDate)} &ndash; {formatDate(active.toDate)}
    </div>
  );
}
