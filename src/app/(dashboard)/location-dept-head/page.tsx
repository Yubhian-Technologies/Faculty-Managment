"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  UsersRound,
  ClipboardCheck,
  Clock,
  ArrowRight,
  UserCheck,
  AlertCircle,
  Building2,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { LocationDeptSwitcher } from "@/components/layout/LocationDeptSwitcher";
import { istDateKey } from "@/lib/attendance/istTime";

interface AttendanceSummary {
  total: number;
  marked: number;
  present: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  pending: number;
}

export default function LocationDeptHeadDashboard() {
  const user = useAuthStore((s) => s.user);
  const { activeDept, activeDeptId, isLoading: deptLoading } = useActiveLocationDept();

  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [shiftCount, setShiftCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!activeDeptId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const today = istDateKey();

    Promise.all([
      fetch(`/api/location/staff-attendance?date=${today}&departmentId=${activeDeptId}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({})))
        .then((d) => setSummary(d.summary || null))
        .catch(() => {}),
      fetch(`/api/location/shifts?departmentId=${activeDeptId}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({})))
        .then((d) => setShiftCount((d.shifts ?? []).length))
        .catch(() => {}),
    ]).finally(() => setIsLoading(false));
  }, [activeDeptId]);

  const departmentName = activeDept?.name ?? user?.department ?? "Department";

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* ── Page Header with Dept Switcher ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-xl border">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-primary border-primary/30 text-xs font-semibold px-2 py-0.5">
              Location Department Head
            </Badge>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Welcome, {user?.name ?? "Dept Head"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-primary" />
            <span>Managing: <strong className="text-foreground">{departmentName}</strong></span>
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <LocationDeptSwitcher />
        </div>
      </div>

      {/* ── Today's Attendance Quick Action Hero (Mobile Optimized) ── */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-background shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Today&rsquo;s Attendance · {istDateKey()}
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-foreground mt-1">
                {isLoading ? "Loading attendance..." : `${summary?.present ?? 0} / ${summary?.total ?? 0} Staff Present`}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary && summary.pending > 0
                  ? `${summary.pending} staff pending check-in/attendance marking`
                  : "All active staff marked for today"}
              </p>
            </div>

            <Button asChild size="default" className="rounded-full gap-2 shadow-sm font-semibold h-11 px-5 w-full sm:w-auto">
              <Link href="/location-dept-head/attendance">
                <ClipboardCheck className="h-4 w-4" />
                <span>Open Attendance Sheet</span>
                <ArrowRight className="h-4 w-4 opacity-70 ml-1" />
              </Link>
            </Button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-border/50 text-center">
            <div className="bg-emerald-500/10 rounded-lg p-2">
              <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium block">Present</span>
              <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{summary?.present ?? 0}</span>
            </div>
            <div className="bg-red-500/10 rounded-lg p-2">
              <span className="text-xs text-red-700 dark:text-red-300 font-medium block">Absent</span>
              <span className="text-lg font-bold text-red-700 dark:text-red-300">{summary?.absent ?? 0}</span>
            </div>
            <div className="bg-amber-500/10 rounded-lg p-2">
              <span className="text-xs text-amber-700 dark:text-amber-300 font-medium block">Half Day</span>
              <span className="text-lg font-bold text-amber-700 dark:text-amber-300">{summary?.halfDay ?? 0}</span>
            </div>
            <div className="bg-purple-500/10 rounded-lg p-2">
              <span className="text-xs text-purple-700 dark:text-purple-300 font-medium block">Leave</span>
              <span className="text-lg font-bold text-purple-700 dark:text-purple-300">{summary?.onLeave ?? 0}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Operational Modules Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Staff Roster Card */}
        <Card className="hover:shadow-md transition-all border-border/80">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <UsersRound className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-foreground">Staff Members</h3>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  Manage staff profiles, Aadhaar, father name, payee/voucher, and photos.
                </p>
              </div>
            </div>
            <div className="mt-5 pt-3 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">
                {summary?.total ?? 0} Active Staff
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-full gap-1 text-xs">
                <Link href="/location-dept-head/staff">
                  <span>Manage Roster</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Shift Schedule Card */}
        <Card className="hover:shadow-md transition-all border-border/80">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Clock className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-foreground">Shift Schedule</h3>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  Create shifts with start & end times and assign department staff.
                </p>
              </div>
            </div>
            <div className="mt-5 pt-3 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">
                {shiftCount} Shifts Active
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-full gap-1 text-xs">
                <Link href="/location-dept-head/shifts">
                  <span>Configure</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Attendance Records Card */}
        <Card className="hover:shadow-md transition-all border-border/80">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <ClipboardCheck className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-foreground">Daily Attendance</h3>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  1-tap auto check-in and check-out tracking for staff shifts.
                </p>
              </div>
            </div>
            <div className="mt-5 pt-3 border-t flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">
                Live IST Timing
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-full gap-1 text-xs">
                <Link href="/location-dept-head/attendance">
                  <span>Take Attendance</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
