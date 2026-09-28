"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { ATTENDANCE_STATUS_LABELS } from "@/types/attendance";
import type { AttendanceStatus } from "@/types/attendance";

interface CalendarDayInfo {
  day: number;
  status: AttendanceStatus;
  late: boolean;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

// Same palette PersonMonthlyAttendanceView uses for its status badges, so a
// day reads the same color whether seen here or in the full attendance
// report - just applied to a filled cell instead of a badge.
function cellClass(status?: AttendanceStatus): string {
  switch (status) {
    case "PRESENT":  return "bg-green-100 text-green-800 border-green-200";
    case "ABSENT":   return "bg-red-100 text-red-800 border-red-200";
    case "HALF_DAY": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "ON_LEAVE": return "bg-blue-100 text-blue-800 border-blue-200";
    case "ON_DUTY":  return "bg-purple-100 text-purple-800 border-purple-200";
    case "HOLIDAY":
    case "WEEKEND":  return "bg-gray-100 text-gray-600 border-gray-200";
    default:         return "text-muted-foreground/60 border-transparent";
  }
}

const LEGEND: { status: AttendanceStatus; label: string }[] = [
  { status: "PRESENT", label: "Present" },
  { status: "ON_LEAVE", label: ATTENDANCE_STATUS_LABELS.ON_LEAVE },
  { status: "ON_DUTY", label: ATTENDANCE_STATUS_LABELS.ON_DUTY },
  { status: "ABSENT", label: "Absent" },
  { status: "HOLIDAY", label: "Holiday" },
];

interface LeaveCalendarProps {
  // Omit to view the signed-in user's own calendar - same convention as
  // LeaveProfileView's own `uid` prop (an approver browsing someone else's
  // leave profile passes theirs through).
  uid?: string;
}

// A month-grid view of someone's own attendance, sitting right beside their
// leave balances (LeaveProfileView) so "how many CL do I have left" and
// "which days did I actually take them" read together at a glance, instead of
// requiring a trip to the separate Attendance module. Deliberately reads
// straight from attendanceRecords (api/leave/attendance-calendar) rather than
// the fuller attendance report machinery - several roles with a Leave page
// (ACADEMICS, FINANCE, ...) never do self-attendance check-in at all, so
// there's no "Absent" to synthesize for them; only days with a real record
// are colored.
export function LeaveCalendar({ uid }: LeaveCalendarProps) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [days, setDays] = useState<CalendarDayInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      if (uid) params.set("uid", uid);
      const res = await fetch(`/api/leave/attendance-calendar?${params.toString()}`);
      const json = (await res.json()) as { days?: CalendarDayInfo[]; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load calendar" });
        return;
      }
      setDays(json.days ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load calendar" });
    } finally {
      setIsLoading(false);
    }
  }, [year, month, uid]);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  interface Cell { day: number; inMonth: boolean; status?: AttendanceStatus; late?: boolean }
  const byDay = new Map(days.map((d) => [d.day, d]));
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  const leadingCount = (firstWeekday + 6) % 7; // Monday-first offset

  const cells: Cell[] = [];
  for (let i = 0; i < leadingCount; i++) cells.push({ day: 0, inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const info = byDay.get(d);
    cells.push({ day: d, inMonth: true, status: info?.status, late: info?.late });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            {MONTH_NAMES[month - 1]} {year}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftMonth(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftMonth(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-56 rounded-lg bg-muted/30 animate-pulse" />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {WEEKDAY_LABELS.map((w, i) => (
                <div key={w} className={i >= 5 ? "text-destructive" : ""}>{w}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((c, i) => (
                <div
                  key={i}
                  title={c.inMonth && c.status ? ATTENDANCE_STATUS_LABELS[c.status] + (c.late ? " · Late" : "") : undefined}
                  className={[
                    "relative aspect-square rounded-md border text-xs flex items-center justify-center",
                    !c.inMonth ? "border-transparent" : cellClass(c.status),
                  ].join(" ")}
                >
                  {c.inMonth ? c.day : ""}
                  {c.inMonth && c.late && (
                    <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              {LEGEND.map((l) => (
                <span key={l.status} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-sm border ${cellClass(l.status)}`} />
                  {l.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Late
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
