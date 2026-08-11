"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from "@/types";

interface RosterEntry {
  uid: string;
  name: string;
  department: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInVerified: boolean;
  checkOutVerified: boolean;
  [key: string]: unknown;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "PRESENT":    return "bg-green-100 text-green-800 border-green-200";
    case "ABSENT":     return "bg-red-100 text-red-800 border-red-200";
    case "HALF_DAY":   return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "ON_LEAVE":   return "bg-blue-100 text-blue-800 border-blue-200";
    case "ON_DUTY":    return "bg-purple-100 text-purple-800 border-purple-200";
    case "NOT_MARKED": return "bg-gray-100 text-gray-600 border-gray-200";
    default:           return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function statusLabel(status: string): string {
  if (status === "NOT_MARKED") return "Not Marked";
  return ATTENDANCE_STATUS_LABELS[status as AttendanceStatus] ?? status;
}

interface AttendanceReportViewProps {
  title: string;
  description: string;
}

export function AttendanceReportView({ title, description }: AttendanceReportViewProps) {
  const [date, setDate] = useState(todayISO());
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/college/attendance/report?date=${date}`)
      .then((r) => r.json() as Promise<{ roster: RosterEntry[]; error?: string }>)
      .then((d) => setRoster(d.roster ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load attendance report" }))
      .finally(() => setIsLoading(false));
  }, [date]);

  const presentCount = roster.filter((r) => r.status === "PRESENT").length;

  const columns: Column<RosterEntry>[] = [
    { key: "name", header: "Faculty" },
    { key: "department", header: "Department", hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
          {statusLabel(row.status)}
        </span>
      ),
    },
    {
      key: "checkIn",
      header: "Check In",
      render: (row) => row.checkIn ? (
        <span className="inline-flex items-center gap-1">
          {row.checkIn}
          {row.checkInVerified && <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Face + location verified" />}
        </span>
      ) : "—",
    },
    {
      key: "checkOut",
      header: "Check Out",
      render: (row) => row.checkOut ? (
        <span className="inline-flex items-center gap-1">
          {row.checkOut}
          {row.checkOutVerified && <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Face + location verified" />}
        </span>
      ) : "—",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="report-date">Date</Label>
          <Input id="report-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
        {!isLoading && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground pb-2.5">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {presentCount} of {roster.length} present
          </div>
        )}
      </div>

      <DataTable
        data={roster}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.uid}
        searchPlaceholder="Search faculty..."
        searchKeys={["name", "department"]}
        emptyTitle="No faculty found"
        csvFilename={`attendance-${date}`}
      />
    </div>
  );
}
