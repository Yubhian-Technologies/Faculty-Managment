"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, BarChart3 } from "lucide-react";
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

type StatKey = "PRESENT" | "ON_LEAVE" | "ON_DUTY" | "ABSENT" | "HALF_DAY" | "LATE" | "PERMISSION";

// Same status set the calendar grid/legend already colors, plus Late (a
// modifier on PRESENT/HALF_DAY, not its own status - see CalendarDayInfo) and
// Permission (a separate, non-leave request type - see types/permission.ts,
// never part of AttendanceStatus), counted for whichever month is currently
// on screen.
const STAT_TILES: { key: StatKey; label: string }[] = [
  { key: "PRESENT", label: "Present" },
  { key: "ON_LEAVE", label: "Leave" },
  { key: "ON_DUTY", label: "On Duty" },
  { key: "ABSENT", label: "Absent" },
  { key: "HALF_DAY", label: "Half Day" },
  { key: "LATE", label: "Late" },
  { key: "PERMISSION", label: "Permission" },
];

// Its own palette, not cellClass's - a deliberately bolder/darker read than
// the calendar cells' own -100/border-200 (those stay as they are; a filled
// grid cell needs to be light enough for its day number to stay legible, a
// stat tile doesn't) so the summary card doesn't look washed out next to it.
function tileClass(key: StatKey): string {
  switch (key) {
    case "PRESENT":    return "bg-green-100 text-green-900 border-green-300";
    case "ON_LEAVE":   return "bg-blue-100 text-blue-900 border-blue-300";
    case "ON_DUTY":    return "bg-purple-100 text-purple-900 border-purple-300";
    case "ABSENT":     return "bg-red-100 text-red-900 border-red-300";
    case "HALF_DAY":   return "bg-yellow-100 text-yellow-900 border-yellow-300";
    case "LATE":       return "bg-orange-100 text-orange-900 border-orange-300";
    case "PERMISSION": return "bg-cyan-100 text-cyan-900 border-cyan-300";
  }
}

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
  const [permissionCount, setPermissionCount] = useState(0);
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

  // Permission requests aren't month-scoped server-side (see
  // /api/leave/permissions) - filtered down to this card's own month here,
  // and to APPROVED only, so the count reads as "how many times they actually
  // got permission this month", not every request regardless of outcome.
  const loadPermissions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (uid) params.set("uid", uid);
      const res = await fetch(`/api/leave/permissions?${params.toString()}`);
      const json = (await res.json()) as { permissions?: { date: string; status: string }[] };
      const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
      setPermissionCount(
        (json.permissions ?? []).filter((p) => p.status === "APPROVED" && p.date.startsWith(monthPrefix)).length
      );
    } catch {
      // Non-fatal - same reasoning as the attendance load above's own catch.
      setPermissionCount(0);
    }
  }, [year, month, uid]);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  useEffect(() => {
    void (async () => { await loadPermissions(); })();
  }, [loadPermissions]);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  const stats = {
    PRESENT: days.filter((d) => d.status === "PRESENT").length,
    ON_LEAVE: days.filter((d) => d.status === "ON_LEAVE").length,
    ON_DUTY: days.filter((d) => d.status === "ON_DUTY").length,
    ABSENT: days.filter((d) => d.status === "ABSENT").length,
    HALF_DAY: days.filter((d) => d.status === "HALF_DAY").length,
    LATE: days.filter((d) => d.late).length,
    PERMISSION: permissionCount,
  };

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
    <div className="grid gap-4 lg:grid-cols-2 items-stretch">
      <Card className="w-full">
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
                      "relative aspect-[5/3] rounded-md border text-xs flex items-center justify-center",
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

      {/* Same month's numbers as the grid on the left, just counted instead
          of colored - fills the space a bare max-w-sm calendar would
          otherwise leave empty next to it on a wide screen. */}
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            {MONTH_NAMES[month - 1]} Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-40 rounded-lg bg-muted/30 animate-pulse" />
          ) : (
            <div className="grid h-full grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 content-start">
              {STAT_TILES.map((t) => (
                <div key={t.key} className={`rounded-lg border p-4 ${tileClass(t.key)}`}>
                  <p className="text-2xl font-semibold leading-none">{stats[t.key]}</p>
                  <p className="mt-1.5 text-xs font-medium">{t.label}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
