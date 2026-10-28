"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { UpcomingNotice } from "@/types";

const DAY_NAMES: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday",
};

const SEEN_KEY = "fms-holiday-reminder-seen";

function describe(n: UpcomingNotice): string {
  switch (n.kind) {
    case "COMPENSATORY_WORKING_DAY":
      return `${n.title}. Classes follow ${DAY_NAMES[n.followsDay ?? ""] ?? "the holiday's weekday"} timetable.`;
    case "SEM_BREAK":
      return `${n.title} begins tomorrow${n.untilKey ? ` and runs until ${formatDate(n.untilKey)}` : ""}.`;
    case "CLASS_SUSPENDED":
      return `Classwork is suspended tomorrow: ${n.title}.`;
    case "BRIDGE":
      return `Tomorrow is a holiday (${n.title}).`;
    default:
      return `Tomorrow is a holiday: ${n.title}.`;
  }
}

// "Tomorrow is a holiday" pop-up, shown once per login (per browser session)
// to every signed-in role - holidays are announced here instead of by circular
// or notice. The server decides what applies to the viewer (students see every
// holiday, staff skip students-only ones), see api/college/holidays/upcoming.
// Rendered in the dashboard shell so it appears on whatever page the login
// lands on.
export function HolidayReminder() {
  const [notices, setNotices] = useState<UpcomingNotice[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/college/holidays/upcoming")
      .then((r) => (r.ok ? (r.json() as Promise<{ date: string; notices: UpcomingNotice[] }>) : null))
      .then((d) => {
        if (cancelled || !d || d.notices.length === 0) return;
        // Same list already acknowledged in this session -> don't nag on every page load.
        const signature = `${d.date}:${d.notices.map((n) => n.id).join(",")}`;
        try {
          if (sessionStorage.getItem(SEEN_KEY) === signature) return;
          sessionStorage.setItem(SEEN_KEY, signature);
        } catch {
          // Storage can be blocked; showing the pop-up each time is the safe failure.
        }
        setNotices(d.notices);
        setOpen(true);
      })
      .catch(() => {
        // A missing reminder isn't worth an error toast.
      });
    return () => { cancelled = true; };
  }, []);

  if (notices.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />Holiday reminder
          </DialogTitle>
          <DialogDescription>Here is what changes tomorrow.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {notices.map((n) => (
            <div key={n.id} className="rounded-lg border p-3 text-sm space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{n.label}</p>
              <p className="text-foreground">{describe(n)}</p>
              {n.hostelersOutingAllowed != null && (
                <p className="text-xs text-muted-foreground">
                  {n.hostelersOutingAllowed ? "Hostellers are permitted to go out (outing)." : "Hostellers are not permitted to go out."}
                </p>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
