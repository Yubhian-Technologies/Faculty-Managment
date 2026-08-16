"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { ATTENDANCE_STATUS_LABELS } from "@/types";
import type { AttendanceRecord, AttendanceStatus } from "@/types";

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

// Read-only: Management's view of a college's Principal's own attendance
// history - same attendanceRecords, same Present/Late derivation
// (isLateCheckIn) the Principal's own "My Attendance" page uses, just fetched
// via /api/management/colleges/[collegeId]/principal-attendance instead of
// the session-scoped /api/college/attendance (Management isn't a member of
// any one college). No edit affordance - Management never edits attendance.
export default function ManagementPrincipalAttendancePage() {
  const { collegeId } = useParams<{ collegeId: string }>();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ["mgmt-principal-attendance", collegeId, year, month],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/principal-attendance?year=${year}&month=${month}`)
        .then((r) => r.json() as Promise<{ principalName: string | null; records: (AttendanceRecord & { id: string })[] }>),
  });

  const principalName = data?.principalName;
  const records = data?.records ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Principal Attendance"
        description={principalName ? `Monthly attendance record for ${principalName}` : "Monthly attendance record"}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/management/faculty/${collegeId}/principal`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, idx) => (
              <SelectItem key={idx + 1} value={String(idx + 1)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !principalName ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">No Principal is currently assigned to this college.</p>
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No attendance records for this month.</p>
          </CardContent>
        </Card>
      ) : (
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
                const dayName = d ? d.toLocaleDateString("en-IN", { weekday: "short" }) : "";

                return (
                  <div key={rec.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="w-32 shrink-0">
                      <p className="text-sm font-medium">{formatDate(rec.date)}</p>
                      <p className="text-xs text-muted-foreground">{dayName}</p>
                    </div>

                    <div className="flex-1 flex items-center gap-1.5">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(rec.status)}`}>
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
                        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          {rec.checkIn ?? "—"} – {rec.checkOut ?? "—"}
                          {rec.checkInVerified && <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Face + location verified" />}
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
    </div>
  );
}
