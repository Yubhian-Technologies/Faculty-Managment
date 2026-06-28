"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarDays, Info } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
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

export default function HODAttendancePage() {
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
    void load(year, month);
  }, [load, year, month]);

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
        description="Monthly attendance records"
      />

      {/* Month / Year selector */}
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

      {/* Not-yet-recorded banner */}
      {noData && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Attendance for this month has not been recorded yet.</span>
        </div>
      )}

      {/* Summary cards */}
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

      {/* Loading skeleton */}
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

      {/* Daily records */}
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
                const rawDate = rec.date as unknown as { toDate?: () => Date; seconds?: number; _seconds?: number } | null;
                const d = rawDate
                  ? typeof rawDate.toDate === "function"
                    ? rawDate.toDate()
                    : new Date(((rawDate._seconds ?? rawDate.seconds) ?? 0) * 1000)
                  : null;

                const dayName = d
                  ? d.toLocaleDateString("en-IN", { weekday: "short" })
                  : "";

                return (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    {/* Date */}
                    <div className="w-32 shrink-0">
                      <p className="text-sm font-medium">{formatDate(rec.date)}</p>
                      <p className="text-xs text-muted-foreground">{dayName}</p>
                    </div>

                    {/* Status badge */}
                    <div className="flex-1">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(rec.status)}`}
                      >
                        {ATTENDANCE_STATUS_LABELS[rec.status]}
                      </span>
                    </div>

                    {/* Check-in / check-out */}
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

      {/* Empty state — month loaded but no records */}
      {!isLoading && !noData && records.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No attendance records for this month.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
