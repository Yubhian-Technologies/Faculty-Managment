"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarDays, Info, LogIn, LogOut, ScanFace } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarkAttendanceDialog } from "@/components/attendance/MarkAttendanceDialog";
import { toast } from "@/hooks/useToast";
import { formatDate, toDate } from "@/lib/utils";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { SUNDAY_HOLIDAY_MESSAGE } from "@/lib/attendance/attendanceWindow";
import type { AttendanceSummary, AttendanceRecord, AttendanceStatus } from "@/types";
import { ATTENDANCE_STATUS_LABELS } from "@/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = [2024, 2025, 2026];

function statusBadgeClass(status: AttendanceStatus): string {
  switch (status) {
    case "PRESENT":  return "bg-green-100 text-green-800 border-green-200";
    case "ABSENT":   return "bg-red-100 text-red-800 border-red-200";
    case "HALF_DAY": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "ON_LEAVE": return "bg-blue-100 text-blue-800 border-blue-200";
    case "ON_DUTY":  return "bg-purple-100 text-purple-800 border-purple-200";
    case "HOLIDAY":  return "bg-gray-100 text-gray-700 border-gray-200";
    case "WEEKEND":  return "bg-gray-100 text-gray-700 border-gray-200";
    default:         return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

interface SummaryCard {
  label: string;
  value: number;
  colorClass: string;
}

export default function PrincipalAttendancePage() {
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [faceRegistered, setFaceRegistered] = useState<boolean | null>(null);
  const [todayStatus, setTodayStatus] = useState<{ isSunday: boolean; isHoliday: boolean; holidayName: string | null; isOnLeave: boolean } | null>(null);
  const [dialogMode, setDialogMode] = useState<"check-in" | "check-out" | "register" | null>(null);

  const loadFaceRegistration = useCallback(async () => {
    try {
      const res = await fetch("/api/college/attendance/face-registration");
      const json = await res.json() as { registered?: boolean };
      setFaceRegistered(!!json.registered);
    } catch {
      /* non-critical - Mark Attendance will show a clear error if the check fails */
    }
  }, []);

  const loadTodayStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/college/attendance/today-status");
      const json = await res.json() as { isSunday?: boolean; isHoliday?: boolean; holidayName?: string | null; isOnLeave?: boolean };
      setTodayStatus({ isSunday: !!json.isSunday, isHoliday: !!json.isHoliday, holidayName: json.holidayName ?? null, isOnLeave: !!json.isOnLeave });
    } catch {
      /* non-critical - Check In will show a clear error server-side if this fails to load */
    }
  }, []);

  const load = useCallback(async (y: number, m: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/attendance?year=${y}&month=${m}`);
      if (!res.ok) throw new Error("Failed to load attendance");
      const json = await res.json() as { summary: AttendanceSummary | null; records: AttendanceRecord[] };
      setSummary(json.summary ?? null);
      setRecords(json.records ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load attendance records" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(year, month); })();
  }, [load, year, month]);

  useEffect(() => {
    void (async () => { await loadFaceRegistration(); })();
  }, [loadFaceRegistration]);

  useEffect(() => {
    void (async () => { await loadTodayStatus(); })();
  }, [loadTodayStatus]);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const todayRecord = isCurrentMonth
    ? records.find((rec) => toDate(rec.date)?.toDateString() === now.toDateString())
    : undefined;

  const summaryCards: SummaryCard[] = summary
    ? [
        { label: "Present",  value: summary.present,  colorClass: "text-green-600" },
        { label: "Absent",   value: summary.absent,   colorClass: "text-red-600" },
        { label: "On Leave", value: summary.onLeave,  colorClass: "text-blue-600" },
        { label: "On Duty",  value: summary.onDuty,   colorClass: "text-purple-600" },
      ]
    : [];

  const noData = !isLoading && summary === null && records.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Attendance"
        description="Your monthly attendance record"
      />

      {isCurrentMonth && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            {todayStatus?.isSunday ? (
              <p className="text-sm text-muted-foreground">{SUNDAY_HOLIDAY_MESSAGE}</p>
            ) : todayStatus?.isHoliday ? (
              <p className="text-sm text-muted-foreground">
                Today is a holiday{todayStatus.holidayName ? ` — ${todayStatus.holidayName}` : ""}. No attendance required.
              </p>
            ) : todayStatus?.isOnLeave ? (
              <p className="text-sm text-muted-foreground">You&apos;re on approved leave today — attendance cannot be marked.</p>
            ) : faceRegistered === false ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Register your face to start using facial attendance check-in.
                </p>
                <Button onClick={() => setDialogMode("register")}>
                  <ScanFace className="h-4 w-4 mr-1.5" /> Register
                </Button>
              </>
            ) : todayRecord?.checkOut ? (
              <p className="text-sm">
                Today&apos;s attendance marked — in at <span className="font-medium">{todayRecord.checkIn}</span>, out at{" "}
                <span className="font-medium">{todayRecord.checkOut}</span>.
              </p>
            ) : todayRecord?.checkIn ? (
              <>
                <p className="text-sm">Checked in at <span className="font-medium">{todayRecord.checkIn}</span>.</p>
                <Button onClick={() => setDialogMode("check-out")}>
                  <LogOut className="h-4 w-4 mr-1.5" /> Check Out
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">You haven&apos;t marked attendance today.</p>
                <Button onClick={() => setDialogMode("check-in")}>
                  <LogIn className="h-4 w-4 mr-1.5" /> Check In
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, idx) => (
              <SelectItem key={idx + 1} value={String(idx + 1)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(year, month)}
          disabled={isLoading}
        >
          {isLoading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {noData && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Attendance for this month has not been recorded yet.</span>
        </div>
      )}

      {!isLoading && summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summaryCards.map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className={`text-3xl font-bold mt-1 ${c.colorClass}`}>{c.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  of {summary.totalWorkingDays} working days
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />
            ))}
          </div>
          <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
        </div>
      )}

      {!isLoading && records.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Daily Records — {MONTH_NAMES[month - 1]} {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {records.map((rec) => {
                const d = toDate(rec.date);

                const dayName = d
                  ? d.toLocaleDateString("en-IN", { weekday: "short" })
                  : "";

                return (
                  <div key={rec.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="w-32 shrink-0">
                      <p className="text-sm font-medium">{formatDate(rec.date)}</p>
                      <p className="text-xs text-muted-foreground">{dayName}</p>
                    </div>

                    <div className="flex-1 flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(rec.status)}`}
                      >
                        {ATTENDANCE_STATUS_LABELS[rec.status]}
                      </span>
                      {rec.status === "PRESENT" && isLateCheckIn(rec.checkIn) && (
                        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                          Late
                        </span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      {rec.checkIn || rec.checkOut ? (
                        <p className="text-xs text-muted-foreground">
                          {rec.checkIn ?? "—"} – {rec.checkOut ?? "—"}
                        </p>
                      ) : null}
                      {rec.remarks ? (
                        <p className="text-xs text-muted-foreground italic mt-0.5">
                          {rec.remarks}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !noData && records.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No attendance records for this month.</p>
          </CardContent>
        </Card>
      )}

      {dialogMode && (
        <MarkAttendanceDialog
          mode={dialogMode}
          open={!!dialogMode}
          onOpenChange={(o) => { if (!o) setDialogMode(null); }}
          onSuccess={() => {
            if (dialogMode === "register") {
              void loadFaceRegistration();
            } else {
              void load(year, month);
            }
          }}
        />
      )}
    </div>
  );
}
